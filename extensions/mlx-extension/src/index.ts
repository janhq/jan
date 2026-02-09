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
} from '@janhq/core'

import { info, warn, error as logError } from '@tauri-apps/plugin-log'
import { invoke } from '@tauri-apps/api/core'
import {
  loadMlxModel,
  unloadMlxModel,
  MlxConfig,
} from '@janhq/tauri-plugin-mlx-api'
import { readGgufMetadata, ModelConfig } from '@janhq/tauri-plugin-llamacpp-api'

// Error message constant
const OUT_OF_CONTEXT_SIZE = 'the request exceeds the available context size.'

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
  autoUnload: boolean = true
  timeout: number = 600
  readonly providerId: string = 'mlx'

  private config: any = {}
  private providerPath!: string
  private apiSecret: string = 'JanMLX'
  private loadingModels = new Map<string, Promise<SessionInfo>>()

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

    this.autoUnload = this.config.auto_unload ?? true
    this.timeout = this.config.timeout ?? 600

    this.getProviderPath()
  }

  async getProviderPath(): Promise<string> {
    if (!this.providerPath) {
      // Use mlx folder for models
      this.providerPath = await joinPath([
        await getJanDataFolderPath(),
        'mlx',
      ])
    }
    return this.providerPath
  }

  override async onUnload(): Promise<void> {
    // Cleanup handled by Tauri plugin on app exit
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value

    if (key === 'auto_unload') {
      this.autoUnload = value as boolean
    } else if (key === 'timeout') {
      this.timeout = value as number
    }
  }

  private async generateApiKey(
    modelId: string,
    port: string
  ): Promise<string> {
    // Reuse the llamacpp plugin's API key generation
    const hash = await invoke<string>('plugin:llamacpp|generate_api_key', {
      modelId: modelId + port,
      apiSecret: this.apiSecret,
    })
    return hash
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

    const api_key = await this.generateApiKey(modelId, String(port))
    const envs: Record<string, string> = {
      MLX_API_KEY: api_key,
    }

    // Resolve model path - could be absolute or relative
    let modelPath: string
    if (modelConfig.model_path.startsWith('/') || modelConfig.model_path.includes(':')) {
      // Absolute path
      modelPath = modelConfig.model_path
    } else {
      // Relative path - resolve from Jan data folder
      modelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])
    }

    const mlxConfig: MlxConfig = {
      ctx_size: cfg.ctx_size ?? 4096,
      n_predict: cfg.n_predict ?? 0,
      threads: cfg.threads ?? 0,
      chat_template: cfg.chat_template ?? '',
      // Batching configuration
      batch_size: cfg.batch_size ?? 4,
      batch_timeout_ms: cfg.batch_timeout_ms ?? 100,
      enable_continuous_batching: cfg.enable_continuous_batching ?? false,
      kv_block_size: cfg.kv_block_size ?? 16,
      enable_prefix_caching: cfg.enable_prefix_caching ?? true,
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
      return sInfo
    } catch (error) {
      logger.error(`Error loading MLX model: ${JSON.stringify(error)}`)
      throw error
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
      return await invoke<SessionInfo>(
        'plugin:mlx|find_mlx_session_by_model',
        { modelId }
      )
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
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionInfo.api_key}`,
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
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.any([
        AbortSignal.timeout(this.timeout * 1000),
        abortController?.signal,
      ]),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `MLX API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
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
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine === 'data: [DONE]') continue

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
    } finally {
      reader.releaseLock()
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
    if (!modelConfig.model_path.startsWith('/') && !modelConfig.model_path.includes(':')) {
      // Model file is at {janDataFolder}/{model_path}
      // Delete the parent folder containing the actual model file
      const janDataFolderPath = await getJanDataFolderPath()
      const modelPath = await joinPath([janDataFolderPath, modelConfig.model_path])
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

    if (sourcePath.startsWith('https://')) {
      // Download from URL to mlx models folder
      const janDataFolderPath = await getJanDataFolderPath()
      const modelDir = await joinPath([janDataFolderPath, 'mlx', 'models', modelId])
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
        `mlx/${modelId}`,
        (transferred: number, total: number) => {
          events.emit(DownloadEvent.onFileDownloadUpdate, {
            modelId,
            percent: transferred / total,
            size: { transferred, total },
            downloadType: 'Model',
          })
        }
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
      // Local file - use absolute path directly
      if (!(await fs.existsSync(sourcePath))) {
        throw new Error(`File not found: ${sourcePath}`)
      }

      // Get file size
      const stat = await fs.fileStat(sourcePath)
      const size_bytes = stat.size

      // Detect capabilities by checking model directory
      const isVision = await this.isVisionSupported(sourcePath)

      // Build capabilities array
      const capabilities: string[] = []
      if (isVision) capabilities.push('vision')

      // Create model.yml with absolute path
      const modelConfig: any = {
        model_path: sourcePath,
        name: modelId,
        size_bytes,
      }

      // For vision models, add mmproj_path pointing to model.safetensors
      if (isVision) {
        const modelDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'))
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

  override async abortImport(modelId: string): Promise<void> {
    // Not applicable for MLX - imports go through llamacpp extension
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
    const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'))
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
          'vl', 'vlm', 'vision', 'llava', 'qwen2vl', 'qwen3vl',
          'idefics', 'fuyu', 'paligemma', 'clip', 'siglip'
        ]
        if (vlmPatterns.some(pattern => archString.includes(pattern))) {
          logger.info(`Vision support detected from config.json: ${architectures[0]}`)
          return true
        }
      }

      // Check for vision-related configuration fields
      if (config.visual_architectures || config.vision_config) {
        logger.info('Vision support detected from visual_architectures/vision_config')
        return true
      }

      // Check for image processor config
      const imageProcessorPath = await joinPath([modelDir, 'image_processor_config.json'])
      if (await fs.existsSync(imageProcessorPath)) {
        logger.info('Vision support detected from image_processor_config.json')
        return true
      }

      // Check preprocessor config for vision
      const preprocessorConfigPath = await joinPath([modelDir, 'preprocessor_config.json'])
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
    if (modelConfig.model_path.startsWith('/') || modelConfig.model_path.includes(':')) {
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
      const tokenizerConfigPath = await joinPath([modelDir, 'tokenizer_config.json'])
      if (await fs.existsSync(tokenizerConfigPath)) {
        try {
          const tokenizerConfigContent = await invoke<string>('read_file_sync', {
            args: [tokenizerConfigPath],
          })
          // Check for tool/function calling indicators
          const tcLower = tokenizerConfigContent.toLowerCase()
          if (tcLower.includes('function_call') ||
              tcLower.includes('tool_use') ||
              tcLower.includes('tools') ||
              tcLower.includes('assistant')) {
            logger.info(`Tool support detected from tokenizer_config.json for ${modelId}`)
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
            /\{\%.*tool.*\%\}/,           // {% tool ... %}
            /\{\%.*function.*\%\}/,       // {% function ... %}
            /\{\%.*tool_call/,
            /\{\%.*tools\./,
            /\{[-]?#.*tool/,
            /\{[-]?%.*tool/,
            /"tool_calls"/,               // "tool_calls" JSON key
            /'tool_calls'/,               // 'tool_calls' JSON key
            /function_call/,
            /tool_use/,
          ]
          for (const pattern of toolPatterns) {
            if (pattern.test(chatTemplateContent)) {
              logger.info(`Tool support detected from chat_template.jinja for ${modelId}`)
              return true
            }
          }
        } catch (e) {
          logger.warn(`Failed to read chat_template.jinja: ${e}`)
        }
      }

      // Check 3: Look for tool-related files
      const toolFiles = ['tools.jinja', 'tool_use.jinja', 'function_calling.jinja']
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
}
