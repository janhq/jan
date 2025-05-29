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

import { invoke } from '@tauri-apps/api/core'

type LlamacppConfig = {
  n_gpu_layers: number;
  ctx_size: number;
  threads: number;
  threads_batch: number;
  n_predict: number;
  batch_size: number;
  ubatch_size: number;
  device: string;
  split_mode: string;
  main_gpu: number;
  flash_attn: boolean;
  cont_batching: boolean;
  no_mmap: boolean;
  mlock: boolean;
  no_kv_offload: boolean;
  cache_type_k: string;
  cache_type_v: string;
  defrag_thold: number;
  rope_scaling: string;
  rope_scale: number;
  rope_freq_base: number;
  rope_freq_scale: number;
  reasoning_budget: number;
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

// Folder structure for downloaded models:
// <Jan's data folder>/models/llamacpp/<modelId>
//  - model.yml (required)
//  - model.gguf (optional, present if downloaded from URL)
//  - mmproj.gguf (optional, present if mmproj exists and it was downloaded from URL)
//
// Contents of model.yml can be found in ModelConfig interface

export default class llamacpp_extension extends AIEngine {
  provider: string = 'llamacpp'
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private downloadManager: any
  private activeSessions: Map<string, sessionInfo> = new Map()
  private modelsBasePath!: string
  private enginesBasePath!: string
  private apiSecret: string = "Jan"

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine
    this.registerSettings(SETTINGS)

    let config = {}
    for (const item of SETTINGS) {
      const defaultValue = item.controllerProps.value
      config[item.key] = this.getSetting<typeof defaultValue>(item.key, defaultValue)
    }
    this.config = config as LlamacppConfig

    this.downloadManager = window.core.extensionManager.getByName('@janhq/download-extension')

    // Initialize models base path - assuming this would be retrieved from settings
    this.modelsBasePath = await joinPath([
      await getJanDataFolderPath(),
      'models',
    ])

    this.enginesBasePath = await joinPath([await getJanDataFolderPath(), 'engines'])
  }

  override async onUnload(): Promise<void> {
    // Terminate all active sessions
    for (const [sessionId, _] of this.activeSessions) {
      try {
        await this.unload(sessionId);
      } catch (error) {
        console.error(`Failed to unload session ${sessionId}:`, error);
      }
    }

    // Clear the sessions map
    this.activeSessions.clear();
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value
  }

  private async generateApiKey(modelId: string): Promise<string> {
    const hash = await invoke<string>('generate_api_key', {
        modelId: modelId,
        apiSecret: this.apiSecret
    })
    return hash
  }

  // Implement the required LocalProvider interface methods
  override async list(): Promise<modelInfo[]> {
    const modelsDir = await joinPath([this.modelsBasePath, this.provider])
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
      const path = await joinPath([this.modelsBasePath, this.provider, modelId, 'model.yml'])
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
    // TODO: sanitize modelId
    let configPath = await joinPath([this.modelsBasePath, this.provider, modelId, 'model.yml'])
    if (await fs.existsSync(configPath)) {
      throw new Error(`Model ${modelId} already exists`)
    }

    const taskId = this.createDownloadTaskId(modelId)

    // this is relative to Jan's data folder
    const modelDir = `models/${this.provider}/${modelId}`

    // we only use these from opts
    // opts.modelPath: URL to the model file
    // opts.mmprojPath: URL to the mmproj file

    let downloadItems: DownloadItem[] = []
    let modelPath = opts.modelPath
    let mmprojPath = opts.mmprojPath

    const modelItem = { url: opts.modelPath, save_path: `${modelDir}/model.gguf` }
    if (opts.modelPath.startsWith("https://")) {
      downloadItems.push(modelItem)
      modelPath = modelItem.save_path
    } else {
      // this should be absolute path
      if (!(await fs.existsSync(modelPath))) {
        throw new Error(`Model file not found: ${modelPath}`)
      }
    }

    if (opts.mmprojPath) {
      const mmprojItem = { url: opts.mmprojPath, save_path: `${modelDir}/mmproj.gguf` }
      if (opts.mmprojPath.startsWith("https://")) {
        downloadItems.push(mmprojItem)
        mmprojPath = mmprojItem.save_path
      } else {
        // this should be absolute path
        if (!(await fs.existsSync(mmprojPath))) {
          throw new Error(`MMProj file not found: ${mmprojPath}`)
        }
      }
    }

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
        await this.downloadManager.downloadFiles(downloadItems, taskId, onProgress)
      } catch (error) {
        console.error('Error downloading model:', modelId, opts, error)
        events.emit('onFileDownloadError', { modelId, downloadType: 'Model' })
        throw error
      }

      // once we reach this point, it either means download finishes or it was cancelled.
      // if there was an error, it would have been caught above
      const eventName = downloadCompleted ? 'onFileDownloadSuccess' : 'onFileDownloadStopped'
      events.emit(eventName, { modelId, downloadType: 'Model' })
    }

    // TODO: check if files are valid GGUF files
    // NOTE: modelPath and mmprojPath can be either relative to Jan's data folder (if they are downloaded)
    // or absolute paths (if they are provided as local files)
    const janDataFolderPath = await getJanDataFolderPath()
    let size_bytes = (await fs.fileStat(await joinPath([janDataFolderPath, modelPath]))).size
    if (mmprojPath) {
      size_bytes += (await fs.fileStat(await joinPath([janDataFolderPath, mmprojPath]))).size
    }

    // TODO: add name as import() argument
    // TODO: add updateModelConfig() method
    const modelConfig = {
      model_path: modelPath,
      mmproj_path: mmprojPath,
      name: modelId,
      size_bytes,
    } as ModelConfig
    await invoke<void>(
      'write_yaml',
      { data: modelConfig, savePath: `${modelDir}/model.yml` },
    )
  }

  override async abortImport(modelId: string): Promise<void> {
    // prepand provider name to avoid name collision
    const taskId = this.createDownloadTaskId(modelId)
    await this.downloadManager.cancelDownload(taskId)
  }

  override async load(opts: loadOptions): Promise<sessionInfo> {
    const args: string[] = []
    const cfg = this.config

    // disable llama-server webui
    args.push('--no-webui')
    // update key for security; TODO: (qnixsynapse) Make it more secure
    const api_key = this.generateApiKey(opts.modelPath)
    args.push(`--api-key ${api_key}`)

    // model option is required
    // TODO: llama.cpp extension lookup model path based on modelId
    args.push('-m', opts.modelPath)
    args.push('-a', opts.modelId)
    args.push('--port', String(opts.port || 8080)) // Default port if not specified

    if (cfg.ctx_size !== undefined) {
      args.push('-c', String(cfg.ctx_size))
    }

    // Add remaining options from the interface
    if (cfg.n_gpu_layers > 0) args.push('-ngl', String(cfg.n_gpu_layers))
    if (cfg.threads > 0) args.push('--threads', String(cfg.threads))
    if (cfg.threads_batch > 0) args.push('--threads-batch', String(cfg.threads_batch))
    if (cfg.ctx_size > 0) args.push('--ctx-size', String(cfg.ctx_size))
    if (cfg.n_predict > 0) args.push('--n-predict', String(cfg.n_predict))
    if (cfg.batch_size > 0) args.push('--batch-size', String(cfg.batch_size))
    if (cfg.ubatch_size > 0) args.push('--ubatch-size', String(cfg.ubatch_size))
    if (cfg.device.length > 0) args.push('--device', cfg.device)
    if (cfg.split_mode.length > 0) args.push('--split-mode', cfg.split_mode)
    if (cfg.main_gpu !== undefined) args.push('--main-gpu', String(cfg.main_gpu))

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
      const sInfo = await invoke<sessionInfo>('load_llama_model', {
        server_path: this.enginesBasePath,
        args: args,
      })

      // Store the session info for later use
      this.activeSessions.set(sInfo.sessionId, sInfo)

      return sInfo
    } catch (error) {
      console.error('Error loading llama-server:', error)
      throw new Error(`Failed to load llama-server: ${error}`)
    }
  }

  override async unload(sessionId: string): Promise<unloadResult> {
    try {
      // Pass the PID as the session_id
      const result = await invoke<unloadResult>('unload_llama_model', {
        session_id: sessionId, // Using PID as session ID
      })

      // If successful, remove from active sessions
      if (result.success) {
        this.activeSessions.delete(sessionId)
        console.log(`Successfully unloaded model with PID ${sessionId}`)
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

  private findSessionByModel(modelName: string): sessionInfo | undefined {
    for (const [, session] of this.activeSessions) {
      if (session.modelName === modelName) {
        return session
      }
    }
    return undefined
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
      'Authorization': `Bearer ${sessionInfo.api_key}`,
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
    const modelDir = await joinPath([this.modelsBasePath, this.provider, modelId])

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
