/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module llamacpp-extension/src/index
 */

import {
  AIEngine,
  getJanDataFolderPath,
  fs,
  joinPath,
  modelInfo,
  loadOptions,
  sessionInfo,
  unloadResult,
  chatCompletion,
  chatCompletionChunk,
  ImportOptions,
  chatCompletionRequest,
  events,
} from '@janhq/core'
import {
  listSupportedBackends,
  downloadBackend,
  isBackendInstalled,
  getBackendExePath,
} from './backend'
import { invoke } from '@tauri-apps/api/core'

type LlamacppConfig = {
  version_backend: string
  n_gpu_layers: number
  ctx_size: number
  threads: number
  threads_batch: number
  n_predict: number
  batch_size: number
  ubatch_size: number
  device: string
  split_mode: string
  main_gpu: number
  flash_attn: boolean
  cont_batching: boolean
  no_mmap: boolean
  mlock: boolean
  no_kv_offload: boolean
  cache_type_k: string
  cache_type_v: string
  defrag_thold: number
  rope_scaling: string
  rope_scale: number
  rope_freq_base: number
  rope_freq_scale: number
  reasoning_budget: number
}

interface DownloadItem {
  url: string
  save_path: string
}

interface ModelConfig {
  model_path: string
  mmproj_path?: string
  name: string // user-friendly
  // some model info that we cache upon import
  size_bytes: number
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */

// Folder structure for llamacpp extension:
// <Jan's data folder>/llamacpp
//  - models/<modelId>/
//    - model.yml (required)
//    - model.gguf (optional, present if downloaded from URL)
//    - mmproj.gguf (optional, present if mmproj exists and it was downloaded from URL)
// Contents of model.yml can be found in ModelConfig interface
//
//  - backends/<backend_version>/<backend_type>/
//    - build/bin/llama-server (or llama-server.exe on Windows)
//
//  - lib/
//    - e.g. libcudart.so.12

export default class llamacpp_extension extends AIEngine {
  provider: string = 'llamacpp'
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private activeSessions: Map<string, sessionInfo> = new Map()
  private providerPath!: string
  private apiSecret: string = 'Jan'

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    let settings = structuredClone(SETTINGS)

    // update backend settings
    for (let item of settings) {
      if (item.key === 'version_backend') {
        // NOTE: is there a race condition between when tauri IPC is available
        // and when the extension is loaded?
        const version_backends = await listSupportedBackends()
        console.log('Available version/backends:', version_backends)
        item.controllerProps.options = version_backends.map((b) => {
          const { version, backend } = b
          const key = `${version}/${backend}`
          return { value: key, name: key }
        })
      }
    }

    this.registerSettings(settings)

    let config = {}
    for (const item of SETTINGS) {
      const defaultValue = item.controllerProps.value
      config[item.key] = await this.getSetting<typeof defaultValue>(
        item.key,
        defaultValue
      )
    }
    this.config = config as LlamacppConfig

    // Initialize models base path - assuming this would be retrieved from settings
    this.providerPath = await joinPath([
      await getJanDataFolderPath(),
      this.providerId,
    ])
  }

  override async onUnload(): Promise<void> {
    // Terminate all active sessions
    for (const [_, sInfo] of this.activeSessions) {
      try {
        await this.unload(sInfo.modelId)
      } catch (error) {
        console.error(`Failed to unload model ${sInfo.modelId}:`, error)
      }
    }

    // Clear the sessions map
    this.activeSessions.clear()
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value

    if (key === 'version_backend') {
      const valueStr = value as string
      const [version, backend] = valueStr.split('/')

      const closure = async () => {
        const isInstalled = await isBackendInstalled(backend, version)
        if (!isInstalled) {
          await downloadBackend(backend, version)
        }
      }
      closure()
    }
  }

  private async generateApiKey(modelId: string, port: string): Promise<string> {
    const hash = await invoke<string>('generate_api_key', {
      modelId: modelId + port,
      apiSecret: this.apiSecret,
    })
    return hash
  }

  // Implement the required LocalProvider interface methods
  override async list(): Promise<modelInfo[]> {
    const modelsDir = await joinPath([this.providerPath, 'models'])
    if (!(await fs.existsSync(modelsDir))) {
      return []
    }

    let modelIds: string[] = []

    // DFS
    let stack = [modelsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()

      // check if model.yml exists
      const modelConfigPath = await joinPath([currentDir, 'model.yml'])
      if (await fs.existsSync(modelConfigPath)) {
        // +1 to remove the leading slash
        // NOTE: this does not handle Windows path \\
        modelIds.push(currentDir.slice(modelsDir.length + 1))
        continue
      }

      // otherwise, look into subdirectories
      const children = await fs.readdirSync(currentDir)
      for (const child of children) {
        // skip files
        const dirInfo = await fs.fileStat(child)
        if (!dirInfo.isDirectory) {
          continue
        }

        stack.push(child)
      }
    }

    let modelInfos: modelInfo[] = []
    for (const modelId of modelIds) {
      const path = await joinPath([
        modelsDir,
        modelId,
        'model.yml',
      ])
      const modelConfig = await invoke<ModelConfig>('read_yaml', { path })

      const modelInfo = {
        id: modelId,
        name: modelConfig.name ?? modelId,
        quant_type: undefined, // TODO: parse quantization type from model.yml or model.gguf
        providerId: this.provider,
        port: 0, // port is not known until the model is loaded
        sizeBytes: modelConfig.size_bytes ?? 0,
      } as modelInfo
      modelInfos.push(modelInfo)
    }

    return modelInfos
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
      this.providerPath,
      'models',
      modelId,
      'model.yml',
    ])
    if (await fs.existsSync(configPath))
      throw new Error(`Model ${modelId} already exists`)

    // this is relative to Jan's data folder
    const modelDir = `${this.providerId}/models/${modelId}`

    // we only use these from opts
    // opts.modelPath: URL to the model file
    // opts.mmprojPath: URL to the mmproj file

    let downloadItems: DownloadItem[] = []

    const maybeDownload = async (path: string, saveName: string) => {
      // if URL, add to downloadItems, and return local path
      if (path.startsWith('https://')) {
        const localPath = `${modelDir}/${saveName}`
        downloadItems.push({ url: path, save_path: localPath })
        return localPath
      }

      // if local file (absolute path), check if it exists
      // and return the path
      if (!(await fs.existsSync(path)))
        throw new Error(`File not found: ${path}`)
      return path
    }

    let modelPath = await maybeDownload(opts.modelPath, 'model.gguf')
    let mmprojPath = opts.mmprojPath ? await maybeDownload(opts.mmprojPath, 'mmproj.gguf') : undefined

    if (downloadItems.length > 0) {
      let downloadCompleted = false

      try {
        // emit download update event on progress
        const onProgress = (transferred: number, total: number) => {
          events.emit('onFileDownloadUpdate', {
            modelId,
            percent: transferred / total,
            size: { transferred, total },
            downloadType: 'Model',
          })
          downloadCompleted = transferred === total
        }
        const downloadManager = window.core.extensionManager.getByName(
          '@janhq/download-extension'
        )
        await downloadManager.downloadFiles(
          downloadItems,
          this.createDownloadTaskId(modelId),
          onProgress
        )

        const eventName = downloadCompleted
          ? 'onFileDownloadSuccess'
          : 'onFileDownloadStopped'
        events.emit(eventName, { modelId, downloadType: 'Model' })
      } catch (error) {
        console.error('Error downloading model:', modelId, opts, error)
        events.emit('onFileDownloadError', { modelId, downloadType: 'Model' })
        throw error
      }
    }

    // TODO: check if files are valid GGUF files
    // NOTE: modelPath and mmprojPath can be either relative to Jan's data folder (if they are downloaded)
    // or absolute paths (if they are provided as local files)
    const janDataFolderPath = await getJanDataFolderPath()
    let size_bytes = (
      await fs.fileStat(await joinPath([janDataFolderPath, modelPath]))
    ).size
    if (mmprojPath) {
      size_bytes += (
        await fs.fileStat(await joinPath([janDataFolderPath, mmprojPath]))
      ).size
    }

    // TODO: add name as import() argument
    // TODO: add updateModelConfig() method
    const modelConfig = {
      model_path: modelPath,
      mmproj_path: mmprojPath,
      name: modelId,
      size_bytes,
    } as ModelConfig
    await fs.mkdir(await joinPath([janDataFolderPath, modelDir]))
    await invoke<void>('write_yaml', {
      data: modelConfig,
      savePath: configPath,
    })
  }

  override async abortImport(modelId: string): Promise<void> {
    // prepand provider name to avoid name collision
    const taskId = this.createDownloadTaskId(modelId)
    const downloadManager = window.core.extensionManager.getByName(
      '@janhq/download-extension'
    )
    await downloadManager.cancelDownload(taskId)
  }

  /**
   * Function to find a random port
   */
  private async getRandomPort(): Promise<number> {
    let port: number
    do {
      port = Math.floor(Math.random() * 1000) + 3000
    } while (
      Array.from(this.activeSessions.values()).some(
        (info) => info.port === port
      )
    )
    return port
  }

  override async load(modelId: string): Promise<sessionInfo> {
    const args: string[] = []
    const cfg = this.config
    const [version, backend] = cfg.version_backend.split('/')
    if (!version || !backend) {
      throw new Error(
        `Invalid version/backend format: ${cfg.version_backend}. Expected format: <version>/<backend>`
      )
    }

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

    // disable llama-server webui
    args.push('--no-webui')
    const api_key = await this.generateApiKey(modelId, String(port))
    args.push('--api-key', api_key)

    // model option is required
    // NOTE: model_path and mmproj_path can be either relative to Jan's data folder or absolute path
    const modelPath = await joinPath([
      janDataFolderPath,
      modelConfig.model_path,
    ])
    args.push('-m', modelPath)
    args.push('-a', modelId)
    args.push('--port', String(port))
    if (modelConfig.mmproj_path) {
      const mmprojPath = await joinPath([
        janDataFolderPath,
        modelConfig.mmproj_path,
      ])
      args.push('--mmproj', mmprojPath)
    }

    if (cfg.ctx_size !== undefined) {
      args.push('-c', String(cfg.ctx_size))
    }

    // Add remaining options from the interface
    if (cfg.n_gpu_layers > 0) args.push('-ngl', String(cfg.n_gpu_layers))
    if (cfg.threads > 0) args.push('--threads', String(cfg.threads))
    if (cfg.threads_batch > 0)
      args.push('--threads-batch', String(cfg.threads_batch))
    if (cfg.ctx_size > 0) args.push('--ctx-size', String(cfg.ctx_size))
    if (cfg.n_predict > 0) args.push('--n-predict', String(cfg.n_predict))
    if (cfg.batch_size > 0) args.push('--batch-size', String(cfg.batch_size))
    if (cfg.ubatch_size > 0) args.push('--ubatch-size', String(cfg.ubatch_size))
    if (cfg.device.length > 0) args.push('--device', cfg.device)
    if (cfg.split_mode.length > 0) args.push('--split-mode', cfg.split_mode)
    if (cfg.main_gpu !== undefined)
      args.push('--main-gpu', String(cfg.main_gpu))

    // Boolean flags
    if (cfg.flash_attn) args.push('--flash-attn')
    if (cfg.cont_batching) args.push('--cont-batching')
    if (cfg.no_mmap) args.push('--no-mmap')
    if (cfg.mlock) args.push('--mlock')
    if (cfg.no_kv_offload) args.push('--no-kv-offload')

    args.push('--cache-type-k', cfg.cache_type_k)
    args.push('--cache-type-v', cfg.cache_type_v)
    args.push('--defrag-thold', String(cfg.defrag_thold))

    args.push('--rope-scaling', cfg.rope_scaling)
    args.push('--rope-scale', String(cfg.rope_scale))
    args.push('--rope-freq-base', String(cfg.rope_freq_base))
    args.push('--rope-freq-scale', String(cfg.rope_freq_scale))
    args.push('--reasoning-budget', String(cfg.reasoning_budget))

    console.log('Calling Tauri command llama_load with args:', args)

    try {
      // TODO: add LIBRARY_PATH
      const sInfo = await invoke<sessionInfo>('load_llama_model', {
        backendPath: await getBackendExePath(backend, version),
        libraryPath: await joinPath([this.providerPath, 'lib']),
        args,
      })

      // Store the session info for later use
      this.activeSessions.set(sInfo.pid, sInfo)

      return sInfo
    } catch (error) {
      console.error('Error loading llama-server:', error)
      throw new Error(`Failed to load llama-server: ${error}`)
    }
  }

  override async unload(modelId: string): Promise<unloadResult> {
    const sInfo: sessionInfo = this.findSessionByModel(modelId)
    if (!sInfo) {
      throw new Error(`No active session found for model: ${modelId}`)
    }
    const pid = sInfo.pid
    try {
      // Pass the PID as the session_id
      const result = await invoke<unloadResult>('unload_llama_model', {
        pid,
      })

      // If successful, remove from active sessions
      if (result.success) {
        this.activeSessions.delete(pid)
        console.log(`Successfully unloaded model with PID ${pid}`)
      } else {
        console.warn(`Failed to unload model: ${result.error}`)
      }

      return result
    } catch (error) {
      console.error('Error in unload command:', error)
      return {
        success: false,
        error: `Failed to unload model: ${error}`,
      }
    }
  }

  private createDownloadTaskId(modelId: string) {
    // prepend provider to make taksId unique across providers
    return `${this.provider}/${modelId}`
  }

  private async *handleStreamingResponse(
    url: string,
    headers: HeadersInit,
    body: string
  ): AsyncIterable<chatCompletionChunk> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
      )
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines in the buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep the last incomplete line in the buffer

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine === 'data: [DONE]') {
            continue
          }

          if (trimmedLine.startsWith('data: ')) {
            const jsonStr = trimmedLine.slice(6)
            try {
              const chunk = JSON.parse(jsonStr) as chatCompletionChunk
              yield chunk
            } catch (e) {
              console.error('Error parsing JSON from stream:', e)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private findSessionByModel(modelId: string): sessionInfo | undefined {
    return Array.from(this.activeSessions.values()).find(
      (session) => session.modelId === modelId
    )
  }

  override async chat(
    opts: chatCompletionRequest
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const sessionInfo = this.findSessionByModel(opts.model)
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }
    const baseUrl = `http://localhost:${sessionInfo.port}/v1`
    const url = `${baseUrl}/chat/completions`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionInfo.apiKey}`,
    }

    const body = JSON.stringify(opts)
    if (opts.stream) {
      return this.handleStreamingResponse(url, headers, body)
    }
    // Handle non-streaming response
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
      )
    }

    return (await response.json()) as chatCompletion
  }

  override async delete(modelId: string): Promise<void> {
    const modelDir = await joinPath([
      this.providerPath,
      'models',
      modelId,
    ])

    if (!(await fs.existsSync(await joinPath([modelDir, 'model.yml'])))) {
      throw new Error(`Model ${modelId} does not exist`)
    }

    await fs.rm(modelDir)
  }

  // Optional method for direct client access
  override getChatClient(sessionId: string): any {
    throw new Error('method not implemented yet')
  }
}
