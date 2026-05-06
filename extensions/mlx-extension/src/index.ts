/**
 * MLX Extension - Inference engine for Apple Silicon Macs using MLX-Swift
 *
 * This extension provides an alternative to llama.cpp for running GGUF models
 * locally on Apple Silicon using the MLX framework with Metal GPU acceleration.
 *
 * It shares the same model directory as llamacpp-extension so users can
 * switch between engines without re-downloading models.
 */

import {
  AIEngine,
  getJanDataFolderPath,
  fs,
  joinPath,
  modelInfo,
  SessionInfo,
  UnloadResult,
  chatCompletion,
  chatCompletionChunk,
  ImportOptions,
  chatCompletionRequest,
  events,
  AppEvent,
  DownloadEvent,
  computeNextCtxLen,
  ModelEvent,
} from '@janhq/core'

import { info, warn, error as logError } from '@tauri-apps/plugin-log'
import { invoke, Channel } from '@tauri-apps/api/core'
import { listen, emit as tauriEmit } from '@tauri-apps/api/event'
import {
  loadMlxModel,
  unloadMlxModel,
  MlxConfig,
} from '@janhq/tauri-plugin-mlx-api'
import { readGgufMetadata, ModelConfig } from '@janhq/tauri-plugin-llamacpp-api'
import { resolveDflashDraft, DraftResolution } from './dflashRegistry'

// Error message constant
const OUT_OF_CONTEXT_SIZE = 'the request exceeds the available context size.'

/// Generic Tauri channels through which the Rust Local API Server proxy
/// (`src-tauri/src/core/server/proxy.rs`) talks to backend extensions about
/// a mid-flight context-window overflow.
const AUTO_INCREASE_CTX_EVENT = 'local_backend://auto_increase_ctx'
const AUTO_INCREASE_CTX_DONE_PREFIX = 'local_backend://auto_increase_ctx_done/'
/// Parallel Tauri-level broadcast so the web-app can subscribe without
/// routing through the `@janhq/core` in-process EventEmitter.
const AUTO_INCREASE_CTX_NOTIFY = 'local_backend://auto_increase_ctx_notify'

interface AutoIncreaseCtxRequest {
  request_id: string
  backend: 'llamacpp' | 'mlx'
  model_id: string
  trigger: 'error' | 'finish_length'
}

const logger = {
  info: function (...args: any[]) {
    console.log(...args)
    info(args.map((arg) => ` ${arg}`).join(` `))
  },
  warn: function (...args: any[]) {
    console.warn(...args)
    warn(args.map((arg) => ` ${arg}`).join(` `))
  },
  error: function (...args: any[]) {
    console.error(...args)
    logError(args.map((arg) => ` ${arg}`).join(` `))
  },
}

export default class mlx_extension extends AIEngine {
  provider: string = 'mlx'
  autoUnload: boolean = false
  timeout: number = 600
  readonly providerId: string = 'mlx'

  private config: any = {}
  private providerPath!: string
  private loadingModels = new Map<string, Promise<SessionInfo>>()

  /// Tracks the `ctx_size` actually used for the currently loaded session
  /// per model. The UI-level setting / extension config may differ from the
  /// live session (e.g. after a prior auto-increase), so we cannot rely on
  /// `this.config.ctx_size` when computing the next window.
  private modelCtxSize = new Map<string, number>()

  private unlistenAutoIncreaseCtx?: () => void

  override async onLoad(): Promise<void> {
    super.onLoad()

    let settings = structuredClone(SETTINGS)
    this.registerSettings(settings)

    let loadedConfig: any = {}
    for (const item of settings) {
      const defaultValue = item.controllerProps.value
      loadedConfig[item.key] = await this.getSetting<typeof defaultValue>(
        item.key,
        defaultValue
      )
    }
    this.config = loadedConfig

    this.timeout = this.config.timeout ?? 600
    this.autoUnload = this.config.auto_unload ?? true

    void this.detectBackendVersion().catch((err) => {
      logger.warn('Failed to detect MLX backend version:', err)
    })

    // Local API Server auto-increase-ctx bridge. Mirrors the listener in
    // llamacpp-extension; only payloads with `backend === 'mlx'` are handled
    // here so remote/other-local extensions don't step on each other.
    this.unlistenAutoIncreaseCtx = await listen<AutoIncreaseCtxRequest>(
      AUTO_INCREASE_CTX_EVENT,
      (event) => {
        if (event.payload?.backend !== 'mlx') return
        void this.handleAutoIncreaseCtx(event.payload)
      }
    )

    this.getProviderPath()
  }

  async getProviderPath(): Promise<string> {
    if (!this.providerPath) {
      this.providerPath = await joinPath([await getJanDataFolderPath(), 'mlx'])
    }
    return this.providerPath
  }

  private async detectBackendVersion(): Promise<void> {
    try {
      const info = await invoke<{ version: string; backend: string }>(
        'plugin:mlx|get_mlx_server_version'
      )

      const version = info.version || 'unknown'
      const backend = info.backend || 'macos-arm64'
      const display = `${version} / ${backend}`

      const currentSettings = await this.getSettings()
      await this.updateSettings(
        currentSettings.map((item: any) => {
          if (item.key === 'version_backend') {
            item.controllerProps.value = display
            item.description = `${backend} is the recommended backend.`
          }
          return item
        })
      )

      logger.info('MLX backend version:', display)
    } catch (err) {
      logger.warn('Could not detect MLX backend version:', err)
    }
  }

  override async onUnload(): Promise<void> {
    if (this.unlistenAutoIncreaseCtx) {
      this.unlistenAutoIncreaseCtx()
      this.unlistenAutoIncreaseCtx = undefined
    }
    // Cleanup handled by Tauri plugin on app exit
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value

    if (key === 'timeout') {
      this.timeout = value as number
    }
  }

  override async get(modelId: string): Promise<modelInfo | undefined> {
    const modelPath = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
    ])
    const path = await joinPath([modelPath, 'model.yml'])

    if (!(await fs.existsSync(path))) return undefined

    const modelConfig = await invoke<ModelConfig>('read_yaml', { path })

    return {
      id: modelId,
      name: modelConfig.name ?? modelId,
      providerId: this.provider,
      port: 0,
      sizeBytes: modelConfig.size_bytes ?? 0,
      embedding: modelConfig.embedding ?? false,
    } as modelInfo
  }

  override async list(): Promise<modelInfo[]> {
    const modelsDir = await joinPath([await this.getProviderPath(), 'models'])
    if (!(await fs.existsSync(modelsDir))) {
      await fs.mkdir(modelsDir)
    }

    let modelIds: string[] = []

    // DFS to find all model.yml files
    let stack = [modelsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()

      const modelConfigPath = await joinPath([currentDir, 'model.yml'])
      if (await fs.existsSync(modelConfigPath)) {
        modelIds.push(currentDir.slice(modelsDir.length + 1))
        continue
      }

      const children = await fs.readdirSync(currentDir)
      for (const child of children) {
        const dirInfo = await fs.fileStat(child)
        if (!dirInfo.isDirectory) continue
        stack.push(child)
      }
    }

    let modelInfos: modelInfo[] = []
    for (const modelId of modelIds) {
      const path = await joinPath([modelsDir, modelId, 'model.yml'])
      const modelConfig = await invoke<ModelConfig>('read_yaml', { path })

      const capabilities: string[] = []
      if (modelConfig.mmproj_path) {
        capabilities.push('vision')
      }

      // Check for tool support
      try {
        if (await this.isToolSupported(modelId)) {
          capabilities.push('tools')
        }
      } catch (e) {
        logger.warn(`Failed to check tool support for ${modelId}: ${e}`)
      }

      modelInfos.push({
        id: modelId,
        name: modelConfig.name ?? modelId,
        providerId: this.provider,
        port: 0,
        sizeBytes: modelConfig.size_bytes ?? 0,
        embedding: modelConfig.embedding ?? false,
        capabilities: capabilities.length > 0 ? capabilities : undefined,
      } as modelInfo)
    }

    return modelInfos
  }

  private async getRandomPort(): Promise<number> {
    try {
      return await invoke<number>('plugin:mlx|get_mlx_random_port')
    } catch {
      logger.error('Unable to find a suitable port for MLX server')
      throw new Error('Unable to find a suitable port for MLX model')
    }
  }

  override async load(
    modelId: string,
    overrideSettings?: any,
    isEmbedding: boolean = false,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo> {
    const sInfo = await this.findSessionByModel(modelId)
    if (sInfo) {
      throw new Error('Model already loaded!')
    }

    if (this.loadingModels.has(modelId)) {
      return this.loadingModels.get(modelId)!
    }

    const loadingPromise = this.performLoad(
      modelId,
      overrideSettings,
      isEmbedding,
      bypassAutoUnload
    )
    this.loadingModels.set(modelId, loadingPromise)

    try {
      return await loadingPromise
    } finally {
      this.loadingModels.delete(modelId)
    }
  }

  private async performLoad(
    modelId: string,
    overrideSettings?: any,
    isEmbedding: boolean = false,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo> {
    const loadedModels = await this.getLoadedModels()

    // Auto-unload other models if needed
    const otherLoadingPromises = Array.from(this.loadingModels.entries())
      .filter(([id, _]) => id !== modelId)
      .map(([_, promise]) => promise)

    if (
      this.autoUnload &&
      !isEmbedding &&
      !bypassAutoUnload &&
      (loadedModels.length > 0 || otherLoadingPromises.length > 0)
    ) {
      if (otherLoadingPromises.length > 0) {
        await Promise.all(otherLoadingPromises)
      }

      const allLoadedModels = await this.getLoadedModels()
      if (allLoadedModels.length > 0) {
        await Promise.all(allLoadedModels.map((id) => this.unload(id)))
      }
    }

    const cfg = { ...this.config, ...(overrideSettings ?? {}) }

    const janDataFolderPath = await getJanDataFolderPath()
    const modelConfigPath = await joinPath([
      this.providerPath,
      'models',
      modelId,
      'model.yml',
    ])
    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path: modelConfigPath,
    })
    const port = await this.getRandomPort()

    // mlx-vlm has no auth layer; we bind the server to 127.0.0.1 in the
    // tauri-plugin-mlx Rust shim instead. `envs` stays around so we can
    // forward `HF_*` / `MLX_TRUST_REMOTE_CODE` style toggles in the future
    // without re-plumbing the plugin contract.
    const envs: Record<string, string> = {}

    // Resolve model path - could be absolute or relative
    let modelPath: string
    if (
      modelConfig.model_path.startsWith('/') ||
      modelConfig.model_path.includes(':')
    ) {
      // Absolute path
      modelPath = modelConfig.model_path
    } else {
      // Relative path - resolve from Jan data folder
      modelPath = await joinPath([janDataFolderPath, modelConfig.model_path])
    }

    /// `dflash_enabled` is the master switch: when off, draft path / block
    /// size are forced empty even if a stale value lingers in `this.config`.
    const dflashOn = !!cfg.dflash_enabled
    const draftPath = dflashOn ? String(cfg.draft_model_path ?? '') : ''
    const blockSize = dflashOn ? Number(cfg.block_size ?? 16) : 0

    const mlxConfig: MlxConfig = {
      ctx_size: Number(cfg.ctx_size ?? 4096),
      draft_model_path: draftPath,
      block_size: blockSize,
    }

    logger.info(
      'Loading MLX model:',
      modelId,
      'with config:',
      JSON.stringify(mlxConfig)
    )

    try {
      const sInfo = await loadMlxModel(
        modelId,
        modelPath,
        port,
        mlxConfig,
        envs,
        isEmbedding,
        Number(this.timeout)
      )
      this.modelCtxSize.set(modelId, mlxConfig.ctx_size)
      return sInfo
    } catch (error) {
      logger.error(`Error loading MLX model: ${JSON.stringify(error)}`)
      throw error
    }
  }

  /// Bridge from the Local API Server proxy (Rust) back to the MLX extension
  /// when a forwarded request exhausts the model's context window. Mirrors
  /// the llamacpp-extension implementation: unload + reload with a larger
  /// `ctx_size`, acknowledge the proxy on a request-scoped channel, and emit
  /// a jan-core event so the web-app UI can mirror the new value.
  private async handleAutoIncreaseCtx(
    payload: AutoIncreaseCtxRequest
  ): Promise<void> {
    const { request_id, model_id, trigger } = payload
    const doneChannel = `${AUTO_INCREASE_CTX_DONE_PREFIX}${request_id}`

    const sendDone = async (body: {
      ok: boolean
      new_ctx_len?: number
      reason?: string
    }) => {
      try {
        await tauriEmit(doneChannel, body)
      } catch (e) {
        logger.warn(
          `Failed to emit auto_increase_ctx_done (${doneChannel}): ${e}`
        )
      }
    }

    try {
      const currentCtxLen =
        this.modelCtxSize.get(model_id) ?? this.config?.ctx_size ?? 4096
      const newCtxLen = computeNextCtxLen(currentCtxLen)

      if (newCtxLen <= currentCtxLen) {
        await sendDone({ ok: false, reason: 'at_max' })
        return
      }

      logger.info(
        `auto_increase_ctx (mlx) model=${model_id} trigger=${trigger} ${currentCtxLen} -> ${newCtxLen}`
      )

      try {
        await this.unload(model_id)
      } catch (e) {
        logger.warn(
          `auto_increase_ctx unload failed for ${model_id}, proceeding anyway: ${e}`
        )
      }

      const sInfo = await this.load(
        model_id,
        { ctx_size: newCtxLen },
        false,
        true
      )
      this.modelCtxSize.set(model_id, newCtxLen)

      const notifyPayload = {
        provider: this.provider,
        modelId: model_id,
        newCtxLen,
      }

      if (events && typeof events.emit === 'function') {
        events.emit(ModelEvent.OnAutoIncreasedCtxLen, notifyPayload)
      }

      try {
        await tauriEmit(AUTO_INCREASE_CTX_NOTIFY, notifyPayload)
      } catch (e) {
        logger.warn(
          `Failed to Tauri-emit ${AUTO_INCREASE_CTX_NOTIFY}: ${e}`
        )
      }

      await sendDone({ ok: true, new_ctx_len: newCtxLen })
      logger.info(
        `auto_increase_ctx (mlx) reload complete model=${model_id} port=${sInfo?.port} newCtxLen=${newCtxLen}; notified UI via events + tauri`
      )
    } catch (e) {
      logger.error(
        `auto_increase_ctx handler failed for ${payload.model_id}: ${e}`
      )
      await sendDone({ ok: false, reason: `exception: ${e}` })
    }
  }

  override async unload(modelId: string): Promise<UnloadResult> {
    const sInfo = await this.findSessionByModel(modelId)
    if (!sInfo) {
      throw new Error(`No active MLX session found for model: ${modelId}`)
    }

    try {
      const result = await unloadMlxModel(sInfo.pid)
      if (result.success) {
        logger.info(`Successfully unloaded MLX model with PID ${sInfo.pid}`)
      } else {
        logger.warn(`Failed to unload MLX model: ${result.error}`)
      }
      return result
    } catch (error) {
      logger.error('Error unloading MLX model:', error)
      return {
        success: false,
        error: `Failed to unload model: ${error}`,
      }
    }
  }

  private async findSessionByModel(modelId: string): Promise<SessionInfo> {
    try {
      return await invoke<SessionInfo>('plugin:mlx|find_mlx_session_by_model', {
        modelId,
      })
    } catch (e) {
      logger.error(e)
      throw new Error(String(e))
    }
  }

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const sessionInfo = await this.findSessionByModel(opts.model)
    if (!sessionInfo) {
      throw new Error(`No active MLX session found for model: ${opts.model}`)
    }

    // Check if the process is alive
    const isAlive = await invoke<boolean>('plugin:mlx|is_mlx_process_running', {
      pid: sessionInfo.pid,
    })

    if (isAlive) {
      try {
        await fetch(`http://localhost:${sessionInfo.port}/health`)
      } catch (e) {
        this.unload(sessionInfo.model_id)
        throw new Error('MLX model appears to have crashed! Please reload!')
      }
    } else {
      throw new Error('MLX model has crashed! Please reload!')
    }

    const baseUrl = `http://localhost:${sessionInfo.port}/v1`
    const url = `${baseUrl}/chat/completions`
    /// mlx-vlm runs without any auth layer; the server binds to 127.0.0.1
    /// in the Rust plugin (`--host 127.0.0.1`), which is the only protection
    /// we rely on. `sessionInfo.api_key` is preserved on the type for ABI
    /// compatibility but is always empty for MLX sessions.
    const headers = {
      'Content-Type': 'application/json',
    }

    const body = JSON.stringify(opts)

    if (opts.stream) {
      return this.handleStreamingResponse(url, headers, body, abortController)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: abortController?.signal,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `MLX API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
      )
    }

    const completionResponse = (await response.json()) as chatCompletion

    if (completionResponse.choices?.[0]?.finish_reason === 'length') {
      throw new Error(OUT_OF_CONTEXT_SIZE)
    }

    return completionResponse
  }

  private async *handleStreamingResponse(
    url: string,
    headers: HeadersInit,
    body: string,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    // Stream via Tauri IPC Channel instead of the intercepted global fetch.
    // tauri_plugin_http overrides window.fetch and routes requests through
    // reqwest, but its ReadableStream bridge does not properly relay SSE chunks
    // back to the webview. Using a dedicated Tauri command + Channel bypasses
    // the plugin entirely.

    const rawChunks: string[] = []
    let streamDone = false
    let streamError: Error | null = null
    let wakeUp: (() => void) | null = null

    const channel = new Channel<{ data: string }>()
    channel.onmessage = (event: { data: string }) => {
      rawChunks.push(event.data)
      if (wakeUp) {
        wakeUp()
        wakeUp = null
      }
    }

    const headersRecord: Record<string, string> = {}
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        headersRecord[k] = String(v)
      }
    }

    const timeoutNum = Number(this.timeout) || 600

    const requestPromise = invoke<number>('stream_local_http', {
      url,
      headers: headersRecord,
      body,
      timeoutSecs: timeoutNum,
      onChunk: channel,
    })

    requestPromise
      .then((status) => {
        logger.info('[mlx-stream] invoke resolved, status:', status)
        streamDone = true
        if (wakeUp) {
          wakeUp()
          wakeUp = null
        }
      })
      .catch((e) => {
        logger.error('[mlx-stream] invoke rejected:', String(e))
        streamError = new Error(String(e))
        streamDone = true
        if (wakeUp) {
          wakeUp()
          wakeUp = null
        }
      })

    if (abortController?.signal) {
      const onAbort = () => {
        streamError = streamError ?? new Error('Request aborted')
        streamDone = true
        if (wakeUp) {
          wakeUp()
          wakeUp = null
        }
      }
      if (abortController.signal.aborted) {
        onAbort()
      } else {
        abortController.signal.addEventListener('abort', onAbort, {
          once: true,
        })
      }
    }

    let buffer = ''

    while (true) {
      while (rawChunks.length === 0 && !streamDone) {
        await new Promise<void>((resolve) => {
          wakeUp = resolve
        })
      }

      while (rawChunks.length > 0) {
        buffer += rawChunks.shift()!
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine === 'data: [DONE]') {
            continue
          }

          if (trimmedLine.startsWith('data: ')) {
            const jsonStr = trimmedLine.slice(6)
            try {
              const data = JSON.parse(jsonStr) as chatCompletionChunk

              if (data.choices?.[0]?.finish_reason === 'length') {
                throw new Error(OUT_OF_CONTEXT_SIZE)
              }

              yield data
            } catch (e) {
              logger.error('Error parsing MLX stream JSON:', e)
              throw e
            }
          } else if (trimmedLine.startsWith('error: ')) {
            const jsonStr = trimmedLine.slice(7)
            const error = JSON.parse(jsonStr)
            throw new Error(error.message)
          }
        }
      }

      if (streamError) throw streamError
      if (streamDone) break
    }
  }

  override async delete(modelId: string): Promise<void> {
    const modelDir = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
    ])

    const modelConfigPath = await joinPath([modelDir, 'model.yml'])
    if (!(await fs.existsSync(modelConfigPath))) {
      throw new Error(`Model ${modelId} does not exist`)
    }

    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path: modelConfigPath,
    })

    // Check if model_path is a relative path within mlx folder
    if (
      !modelConfig.model_path.startsWith('/') &&
      !modelConfig.model_path.includes(':')
    ) {
      // Model file is at {janDataFolder}/{model_path}
      // Delete the parent folder containing the actual model file
      const janDataFolderPath = await getJanDataFolderPath()
      const modelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])
      const parentDir = modelPath.substring(0, modelPath.lastIndexOf('/'))
      // Only delete if it's different from modelDir (i.e., not the same folder)
      if (parentDir !== modelDir) {
        await fs.rm(parentDir)
      }
    }

    // Always delete the model.yml folder
    await fs.rm(modelDir)
  }

  override async update(
    modelId: string,
    model: Partial<modelInfo>
  ): Promise<void> {
    // Delegate to the same logic as llamacpp since they share the model dir
    const modelFolderPath = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
    ])
    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path: await joinPath([modelFolderPath, 'model.yml']),
    })
    const newFolderPath = await joinPath([
      await this.getProviderPath(),
      'models',
      model.id,
    ])
    if (await fs.existsSync(newFolderPath)) {
      throw new Error(`Model with ID ${model.id} already exists`)
    }
    const newModelConfigPath = await joinPath([newFolderPath, 'model.yml'])
    await fs.mv(modelFolderPath, newFolderPath).then(() =>
      invoke('write_yaml', {
        data: {
          ...modelConfig,
          model_path: modelConfig?.model_path?.replace(
            `mlx/models/${modelId}`,
            `mlx/models/${model.id}`
          ),
        },
        savePath: newModelConfigPath,
      })
    )
  }

  override async import(modelId: string, opts: ImportOptions): Promise<void> {
    const isValidModelId = (id: string) => {
      // only allow alphanumeric, underscore, hyphen, and dot characters in modelId
      if (!/^[a-zA-Z0-9/_\-\.]+$/.test(id)) return false

      // check for empty parts or path traversal
      const parts = id.split('/')
      return parts.every((s) => s !== '' && s !== '.' && s !== '..')
    }

    if (!isValidModelId(modelId))
      throw new Error(
        `Invalid modelId: ${modelId}. Only alphanumeric and / _ - . characters are allowed.`
      )

    const configPath = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
      'model.yml',
    ])
    if (await fs.existsSync(configPath))
      throw new Error(`Model ${modelId} already exists`)

    const sourcePath = opts.modelPath
    const resumeDownload = (opts as ImportOptions & { resume?: boolean }).resume

    if (sourcePath.startsWith('https://')) {
      // Download from URL to mlx models folder
      const janDataFolderPath = await getJanDataFolderPath()
      const modelDir = await joinPath([
        janDataFolderPath,
        'mlx',
        'models',
        modelId,
      ])
      const localPath = await joinPath([modelDir, 'model.safetensors'])

      const downloadManager = window.core.extensionManager.getByName(
        '@janhq/download-extension'
      )

      // Build download items list
      const downloadItems: any[] = [
        {
          url: sourcePath,
          save_path: localPath,
          model_id: modelId,
        },
      ]

      // Add additional files if provided (for MLX models - config.json, tokenizer, etc.)
      if (opts.files && opts.files.length > 0) {
        for (const file of opts.files) {
          downloadItems.push({
            url: file.url,
            save_path: await joinPath([modelDir, file.filename]),
            model_id: modelId,
          })
        }
      }

      await downloadManager.downloadFiles(
        downloadItems,
        this.createDownloadTaskId(modelId),
        (transferred: number, total: number) => {
          events.emit(DownloadEvent.onFileDownloadUpdate, {
            modelId,
            percent: transferred / total,
            size: { transferred, total },
            downloadType: 'Model',
          })
        },
        resumeDownload ?? false
      )

      // Emit download success event so DownloadManagement clears the download state
      events.emit('onFileDownloadSuccess', { modelId, downloadType: 'Model' })

      // Detect capabilities after download
      const isVision = await this.isVisionSupported(localPath)

      // Build capabilities array
      const capabilities: string[] = []
      if (isVision) capabilities.push('vision')

      // Create model.yml with relative path
      const modelConfig: any = {
        model_path: `mlx/models/${modelId}/model.safetensors`,
        name: modelId,
        size_bytes: opts.modelSize ?? 0,
      }

      // For vision models, add mmproj_path
      if (isVision) {
        modelConfig.mmproj_path = `mlx/models/${modelId}/model.safetensors`
        logger.info(`Vision model detected: ${modelId}`)
      }

      // Add capabilities array
      if (capabilities.length > 0) {
        modelConfig.capabilities = capabilities
      }

      await fs.mkdir(modelDir)
      await invoke<void>('write_yaml', {
        data: modelConfig,
        savePath: configPath,
      })

      events.emit(AppEvent.onModelImported, {
        modelId,
        modelPath: modelConfig.model_path,
        size_bytes: modelConfig.size_bytes,
        capabilities: capabilities,
      })
    } else {
      // Local folder - use absolute folder path directly
      if (!(await fs.existsSync(sourcePath))) {
        throw new Error(`Folder not found: ${sourcePath}`)
      }

      // Get folder size
      const stat = await fs.fileStat(sourcePath)
      const size_bytes = stat.size

      // Detect capabilities by checking model folder
      const isVision = await this.isVisionSupported(sourcePath)

      // Build capabilities array
      const capabilities: string[] = []
      if (isVision) capabilities.push('vision')

      // Create model.yml with absolute folder path
      const modelConfig: any = {
        model_path: sourcePath,
        name: modelId,
        size_bytes,
      }

      // For vision models, add mmproj_path
      if (isVision) {
        modelConfig.mmproj_path = sourcePath
        logger.info(`Vision model detected: ${modelId}`)
      }

      // Add capabilities array
      if (capabilities.length > 0) {
        modelConfig.capabilities = capabilities
      }

      // Create model folder for model.yml only (no copying of safetensors)
      const modelDir = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
      ])
      await fs.mkdir(modelDir)

      await invoke<void>('write_yaml', {
        data: modelConfig,
        savePath: configPath,
      })

      events.emit(AppEvent.onModelImported, {
        modelId,
        modelPath: sourcePath,
        size_bytes,
        capabilities: capabilities,
      })
    }
  }

  private createDownloadTaskId(modelId: string) {
    // prepend provider to make taksId unique across providers
    const cleanModelId = modelId.includes('.')
      ? modelId.slice(0, modelId.indexOf('.'))
      : modelId
    return `${this.provider}/${cleanModelId}`
  }

  override async abortImport(modelId: string): Promise<void> {
    // Cancel any active download task
    // prepend provider name to avoid name collision
    const taskId = this.createDownloadTaskId(modelId)
    const downloadManager = window.core.extensionManager.getByName(
      '@janhq/download-extension'
    )

    try {
      await downloadManager.cancelDownload(taskId)
    } catch (cancelError) {
      logger.warn('Failed to cancel download task:', cancelError)
    }
  }

  /**
   * Deletes the entire model folder for a given modelId
   * @param modelId The model ID to delete
   */
  private async deleteModelFolder(modelId: string): Promise<void> {
    try {
      const modelDir = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
      ])

      if (await fs.existsSync(modelDir)) {
        logger.info(`Cleaning up model directory: ${modelDir}`)
        await fs.rm(modelDir)
      }
    } catch (deleteError) {
      logger.warn('Failed to delete model directory:', deleteError)
    }
  }

  override async getLoadedModels(): Promise<string[]> {
    try {
      return await invoke<string[]>('plugin:mlx|get_mlx_loaded_models')
    } catch (e) {
      logger.error(e)
      throw new Error(e)
    }
  }

  async isVisionSupported(modelPath: string): Promise<boolean> {
    // Check if model is a Vision Language Model by examining config.json
    // modelPath can be a folder path or a file path; resolve to directory
    const stat = await fs.fileStat(modelPath).catch(() => null)
    const modelDir =
      stat && stat.isDirectory
        ? modelPath
        : modelPath.substring(0, modelPath.lastIndexOf('/'))
    const configPath = await joinPath([modelDir, 'config.json'])

    if (!(await fs.existsSync(configPath))) {
      return false
    }

    try {
      const configContent = await invoke<string>('read_file_sync', {
        args: [configPath],
      })
      const config = JSON.parse(configContent)

      // Check architecture for vision models
      const architectures = config.architectures
      if (architectures && Array.isArray(architectures)) {
        const archString = architectures[0]?.toString().toLowerCase() ?? ''
        // Common VLM architecture suffixes
        const vlmPatterns = [
          'vl',
          'vlm',
          'vision',
          'llava',
          'qwen2vl',
          'qwen3vl',
          'idefics',
          'fuyu',
          'paligemma',
          'clip',
          'siglip',
        ]
        if (vlmPatterns.some((pattern) => archString.includes(pattern))) {
          logger.info(
            `Vision support detected from config.json: ${architectures[0]}`
          )
          return true
        }
      }

      // Check for vision-related configuration fields
      if (config.visual_architectures || config.vision_config) {
        logger.info(
          'Vision support detected from visual_architectures/vision_config'
        )
        return true
      }

      // Check for image processor config
      const imageProcessorPath = await joinPath([
        modelDir,
        'image_processor_config.json',
      ])
      if (await fs.existsSync(imageProcessorPath)) {
        logger.info('Vision support detected from image_processor_config.json')
        return true
      }

      // Check preprocessor config for vision
      const preprocessorConfigPath = await joinPath([
        modelDir,
        'preprocessor_config.json',
      ])
      if (await fs.existsSync(preprocessorConfigPath)) {
        try {
          const preprocessorConfig = await invoke<string>('read_file_sync', {
            args: [preprocessorConfigPath],
          })
          const pc = JSON.parse(preprocessorConfig)
          if (pc.do_resize || pc.size || pc.patch_size) {
            logger.info('Vision support detected from preprocessor_config.json')
            return true
          }
        } catch (e) {
          // Ignore
        }
      }

      return false
    } catch (e) {
      logger.warn(`Failed to check vision support for ${modelPath}: ${e}`)
      return false
    }
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    // Check GGUF/safetensors metadata for tool support
    const modelConfigPath = await joinPath([
      this.providerPath,
      'models',
      modelId,
      'model.yml',
    ])
    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path: modelConfigPath,
    })

    // model_path could be absolute or relative
    let modelPath: string
    if (
      modelConfig.model_path.startsWith('/') ||
      modelConfig.model_path.includes(':')
    ) {
      // Absolute path
      modelPath = modelConfig.model_path
    } else {
      // Relative path - resolve from Jan data folder
      const janDataFolderPath = await getJanDataFolderPath()
      modelPath = await joinPath([janDataFolderPath, modelConfig.model_path])
    }

    // Check if model is safetensors or GGUF
    const isSafetensors = modelPath.endsWith('.safetensors')
    const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'))

    // For safetensors models, check multiple sources for tool support
    if (isSafetensors) {
      // Check 1: tokenizer_config.json (common for tool-capable models)
      const tokenizerConfigPath = await joinPath([
        modelDir,
        'tokenizer_config.json',
      ])
      if (await fs.existsSync(tokenizerConfigPath)) {
        try {
          const tokenizerConfigContent = await invoke<string>(
            'read_file_sync',
            {
              args: [tokenizerConfigPath],
            }
          )
          // Check for tool/function calling indicators
          const tcLower = tokenizerConfigContent.toLowerCase()
          if (
            tcLower.includes('function_call') ||
            tcLower.includes('tool_use') ||
            tcLower.includes('tools') ||
            tcLower.includes('assistant')
          ) {
            logger.info(
              `Tool support detected from tokenizer_config.json for ${modelId}`
            )
            return true
          }
        } catch (e) {
          logger.warn(`Failed to read tokenizer_config.json: ${e}`)
        }
      }

      // Check 2: chat_template.jinja for tool patterns
      const chatTemplatePath = await joinPath([modelDir, 'chat_template.jinja'])
      if (await fs.existsSync(chatTemplatePath)) {
        try {
          const chatTemplateContent = await invoke<string>('read_file_sync', {
            args: [chatTemplatePath],
          })
          // Common tool/function calling template patterns
          const ctLower = chatTemplateContent.toLowerCase()
          const toolPatterns = [
            /\{\%.*tool.*\%\}/, // {% tool ... %}
            /\{\%.*function.*\%\}/, // {% function ... %}
            /\{\%.*tool_call/,
            /\{\%.*tools\./,
            /\{[-]?#.*tool/,
            /\{[-]?%.*tool/,
            /"tool_calls"/, // "tool_calls" JSON key
            /'tool_calls'/, // 'tool_calls' JSON key
            /function_call/,
            /tool_use/,
          ]
          for (const pattern of toolPatterns) {
            if (pattern.test(chatTemplateContent)) {
              logger.info(
                `Tool support detected from chat_template.jinja for ${modelId}`
              )
              return true
            }
          }
        } catch (e) {
          logger.warn(`Failed to read chat_template.jinja: ${e}`)
        }
      }

      // Check 3: Look for tool-related files
      const toolFiles = [
        'tools.jinja',
        'tool_use.jinja',
        'function_calling.jinja',
      ]
      for (const toolFile of toolFiles) {
        const toolPath = await joinPath([modelDir, toolFile])
        if (await fs.existsSync(toolPath)) {
          logger.info(`Tool support detected from ${toolFile} for ${modelId}`)
          return true
        }
      }

      logger.info(`No tool support detected for safetensors model ${modelId}`)
      return false
    } else {
      // For GGUF models, check metadata
      try {
        const metadata = await readGgufMetadata(modelPath)
        const chatTemplate = metadata.metadata?.['tokenizer.chat_template']
        return chatTemplate?.includes('tools') ?? false
      } catch (e) {
        logger.warn(`Failed to read GGUF metadata: ${e}`)
        return false
      }
    }
  }

  /// ──────────────────────────────────────────────────────────────────
  /// DFlash speculative decoding orchestration
  /// ──────────────────────────────────────────────────────────────────
  ///
  /// The provider-level toggle in the UI calls into these methods. The
  /// actual `--draft-model <path>` flag is plumbed through `performLoad`
  /// via `MlxConfig.draft_model_path` (see commands.rs lines 100-108).

  /**
   * Local folder where auto-downloaded DFlash drafts are cached. Lives
   * alongside `mlx/models/` under the Jan data dir so manually-imported
   * z-lab models in `mlx/models/` and tool-managed copies in
   * `mlx/draft-models/` share the same parent.
   */
  private async getDflashDraftRoot(): Promise<string> {
    return await joinPath([
      await getJanDataFolderPath(),
      'mlx',
      'draft-models',
    ])
  }

  /**
   * Resolve an already-present draft directory for `repo`, if any.
   *
   * Lookup order:
   *   1. `mlx/models/<repo with '/' -> '_'>/`  — the canonical layout produced
   *      by importing a HF repo through the regular MLX import flow (e.g. the
   *      user manually adding `z-lab/Qwen3.5-4B-DFlash`).
   *   2. `mlx/draft-models/<repo>/`            — auto-downloaded cache from a
   *      previous `enableDflash` run.
   *
   * A directory is considered usable when:
   *   - `config.json` is present, AND
   *   - any `*.safetensors` weight file (single-file `model.safetensors`
   *     OR sharded `model-*.safetensors` plus `model.safetensors.index.json`)
   *     is present.
   *
   * This mirrors what `dflash.model_mlx.load_draft` actually reads, and
   * makes the lookup forgiving of repos that ship sharded weights.
   */
  private async resolveLocalDraftDir(repo: string): Promise<string | null> {
    const janDataFolderPath = await getJanDataFolderPath()

    const candidates = [
      await joinPath([
        janDataFolderPath,
        'mlx',
        'models',
        repo.split('/').join('_'),
      ]),
      await joinPath([janDataFolderPath, 'mlx', 'draft-models', repo]),
    ]

    for (const dir of candidates) {
      if (!(await fs.existsSync(dir))) continue

      const configPath = await joinPath([dir, 'config.json'])
      if (!(await fs.existsSync(configPath))) continue

      const entries = await fs.readdirSync(dir).catch(() => [] as string[])
      /// `fs.readdirSync` from `@janhq/core` returns full absolute paths.
      const hasWeights = entries.some((p) => /\.safetensors$/i.test(p))
      if (!hasWeights) continue

      logger.info(`resolveLocalDraftDir: ${repo} found at ${dir}`)
      return dir
    }

    return null
  }

  /**
   * Whether the given MLX model has a known DFlash draft sibling.
   *
   * Pure / synchronous registry lookup — never touches the network. The
   * resolved manifest is returned alongside so the caller can hand it back
   * to `enableDflash` without re-resolving.
   */
  async checkDflashSupport(modelId: string): Promise<{
    supported: boolean
    repo?: string
    required?: string[]
    optional?: string[]
    /// True iff a usable draft directory is already present on disk —
    /// the UI uses this to choose between a "Loading…" toast (instant
    /// hand-off to the MLX server) and a "Downloading…" toast.
    local?: boolean
    localPath?: string
  }> {
    logger.info(`checkDflashSupport: resolving draft for ${modelId}`)
    try {
      const resolution = resolveDflashDraft(modelId)
      if (!resolution) {
        logger.info(`checkDflashSupport: ${modelId} unsupported`)
        return { supported: false }
      }
      const localPath = await this.resolveLocalDraftDir(resolution.repo)
      logger.info(
        `checkDflashSupport: ${modelId} -> ${resolution.repo}` +
          (localPath ? ` (local: ${localPath})` : ' (needs download)')
      )
      return {
        supported: true,
        repo: resolution.repo,
        required: resolution.required,
        optional: resolution.optional,
        local: localPath !== null,
        localPath: localPath ?? undefined,
      }
    } catch (e) {
      logger.warn(`checkDflashSupport failed for ${modelId}: ${e}`)
      return { supported: false }
    }
  }

  /**
   * Ensure a usable draft directory exists on disk and return its absolute
   * path (suitable for `--draft-model <dir>`).
   *
   * Local-first: if the user already imported the draft repo into
   * `mlx/models/...` or a previous run cached it under `mlx/draft-models/...`,
   * no network call is made. Otherwise required + optional files are pulled
   * directly from `https://huggingface.co/<repo>/resolve/main/<file>` —
   * `huggingface.co/api/...` is never touched.
   */
  async ensureDflashDraftDownloaded(
    repo: string,
    required: string[],
    optional: string[] = []
  ): Promise<string> {
    const local = await this.resolveLocalDraftDir(repo)
    if (local) {
      logger.info(`ensureDflashDraftDownloaded: using local ${local}`)
      return local
    }

    const draftRoot = await this.getDflashDraftRoot()
    const draftDir = await joinPath([draftRoot, repo])

    if (!(await fs.existsSync(draftRoot))) {
      await fs.mkdir(draftRoot)
    }
    if (!(await fs.existsSync(draftDir))) {
      await fs.mkdir(draftDir)
    }

    /// Required files are mandatory; optional ones are best-effort. We list
    /// `required` first so a 404 on those bubbles up before optional misses
    /// are even attempted.
    const missingRequired: string[] = []
    for (const f of required) {
      const target = await joinPath([draftDir, f])
      if (!(await fs.existsSync(target))) missingRequired.push(f)
    }
    const missingOptional: string[] = []
    for (const f of optional) {
      const target = await joinPath([draftDir, f])
      if (!(await fs.existsSync(target))) missingOptional.push(f)
    }

    if (missingRequired.length === 0 && missingOptional.length === 0) {
      logger.info(`DFlash draft already present: ${draftDir}`)
      return draftDir
    }

    logger.info(
      `ensureDflashDraftDownloaded: ${repo} missing required=${missingRequired.length} optional=${missingOptional.length}; downloading to ${draftDir}`
    )

    const downloadManager = window.core.extensionManager.getByName(
      '@janhq/download-extension'
    )

    /// Tauri event names allow only alphanumeric, `-`, `/`, `:` and `_`.
    /// Repo ids like `Qwen3.5-4B-DFlash` and filenames like
    /// `chat_template.jinja` contain dots, which would otherwise crash the
    /// `listen('download-${taskId}', ...)` call inside the download
    /// manager. Sanitize once and reuse.
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9\-_/:]/g, '_')
    const safeRepoId = sanitize(repo)
    /// Prefix with `mlx/dflash:` so that
    ///   * the download popover's `download.id.startsWith('mlx')` cancel
    ///     routing routes back through the download manager;
    ///   * users can tell DFlash drafts apart from regular MLX downloads.
    const downloadModelId = `mlx/dflash:${safeRepoId}`

    const buildItem = async (filename: string) => ({
      url: `https://huggingface.co/${repo}/resolve/main/${filename}`,
      save_path: await joinPath([draftDir, filename]),
      model_id: downloadModelId,
    })

    /// Required pass: download everything in one batch; if it fails, abort —
    /// a missing required file means the repo is genuinely broken or the
    /// manifest is wrong.
    if (missingRequired.length > 0) {
      const items: any[] = []
      for (const f of missingRequired) items.push(await buildItem(f))

      await downloadManager.downloadFiles(
        items,
        downloadModelId,
        (transferred: number, total: number) => {
          events.emit(DownloadEvent.onFileDownloadUpdate, {
            modelId: downloadModelId,
            percent: total > 0 ? transferred / total : 0,
            size: { transferred, total },
            downloadType: 'Model',
          })
        },
        false
      )
    }

    /// Optional pass: try each file individually so a 404 on one does not
    /// poison the whole batch. Failures are logged and swallowed. The
    /// per-file taskId must also be sanitized — `chat_template.jinja` and
    /// friends carry a dot.
    for (const f of missingOptional) {
      try {
        const item = await buildItem(f)
        await downloadManager.downloadFiles(
          [item],
          `${downloadModelId}/opt/${sanitize(f)}`,
          () => {
            /* optional file progress is not surfaced in the popover */
          },
          false
        )
      } catch (e) {
        logger.info(
          `ensureDflashDraftDownloaded: optional ${f} unavailable for ${repo}: ${e}`
        )
      }
    }

    events.emit('onFileDownloadSuccess', {
      modelId: downloadModelId,
      downloadType: 'Model',
    })

    logger.info(`DFlash draft '${repo}' ready at ${draftDir}`)
    return draftDir
  }

  /**
   * Enable DFlash for `modelId`: resolve the manifest, ensure the draft
   * directory exists locally (download if needed), unload the active
   * session, and reload it with the draft path wired in.
   *
   * `prefetched` lets callers reuse the result of `checkDflashSupport` so
   * the static lookup is not repeated.
   */
  async enableDflash(
    modelId: string,
    blockSize: number = 16,
    prefetched?: {
      repo: string
      required?: string[]
      optional?: string[]
    }
  ): Promise<void> {
    let resolution: DraftResolution
    if (prefetched?.repo) {
      resolution = {
        repo: prefetched.repo,
        required: prefetched.required ?? [],
        optional: prefetched.optional ?? [],
      }
      /// Empty `required` would short-circuit local lookup; in that case
      /// pull the canonical manifest so we still know what to verify.
      if (resolution.required.length === 0) {
        const fresh = resolveDflashDraft(prefetched.repo)
        if (fresh) {
          resolution = fresh
        }
      }
    } else {
      const fresh = resolveDflashDraft(modelId)
      if (!fresh) {
        throw new Error(`Model ${modelId} does not support DFlash`)
      }
      resolution = fresh
    }

    const draftDir = await this.ensureDflashDraftDownloaded(
      resolution.repo,
      resolution.required,
      resolution.optional
    )
    logger.info(`enableDflash: draft ready at ${draftDir}`)

    /// Unload + reload the live session so the DFlash server is restarted
    /// with the new CLI flags. `findSessionByModel` returns undefined when
    /// no session exists; in that case the next manual start will pick up
    /// the toggle from `this.config`.
    const sInfo = await this.findSessionByModel(modelId)
    if (sInfo) {
      logger.info(`enableDflash: reloading ${modelId} with DFlash`)
      try {
        await this.unload(modelId)
      } catch (e) {
        logger.warn(`enableDflash: unload failed for ${modelId}: ${e}`)
      }
      await this.load(modelId, {
        dflash_enabled: true,
        draft_model_path: draftDir,
        block_size: blockSize,
      })
      logger.info(`enableDflash: ${modelId} reloaded with DFlash`)
    }

    /// Update in-memory config so subsequent `performLoad` calls (e.g. from
    /// auto-increase-ctx, or a fresh start) keep DFlash enabled.
    this.config.dflash_enabled = true
    this.config.draft_model_path = draftDir
    this.config.block_size = blockSize
  }

  /**
   * Disable DFlash for `modelId`: unload + reload as plain MLX.
   */
  async disableDflash(modelId: string): Promise<void> {
    const sInfo = await this.findSessionByModel(modelId)
    if (sInfo) {
      try {
        await this.unload(modelId)
      } catch (e) {
        logger.warn(`disableDflash: unload failed for ${modelId}: ${e}`)
      }
      await this.load(modelId, {
        dflash_enabled: false,
        draft_model_path: '',
        block_size: 0,
      })
    }

    this.config.dflash_enabled = false
    this.config.draft_model_path = ''
  }
}
