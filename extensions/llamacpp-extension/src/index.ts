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
  SessionInfo,
  UnloadResult,
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
  auto_unload: boolean
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

interface EmbeddingResponse {
  model: string
  object: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
  data: EmbeddingData[]
}

interface EmbeddingData {
  embedding: number[]
  index: number
  object: string
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
  autoUnload: boolean = true
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private activeSessions: Map<string, SessionInfo> = new Map()
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
        let bestBackend: { version: string, backend: string } | undefined
        const backendPriorities: string[] = ['cuda-cu12.0', 'cuda-cu11.7', 'vulkan', 'avx512', 'avx2', 'avx', 'noavx', 'arm64', 'x64']
        const getBackendCategory = (backendString: string): string | undefined => {
            if (backendString.includes('cu12.0')) return 'cuda-cu12.0'
            if (backendString.includes('cu11.7')) return 'cuda-cu11.7'
            if (backendString.includes('vulkan')) return 'vulkan'
            // TODO: more GPU backends such as SYCL/HIP
            if (backendString.includes('avx512')) return 'avx512'
            if (backendString.includes('avx2')) return 'avx2'
            if (backendString.includes('avx') && !backendString.includes('avx2') && !backendString.includes('avx512')) return 'avx'
            if (backendString.includes('noavx')) return 'noavx'
            // Fallback for OS/arch specific generics if no specific features mentioned
            if (backendString.endsWith('arm64')) return 'arm64'
            if (backendString.endsWith('x64')) return 'x64'
            return undefined;
        }
        for (const priorityCategory of backendPriorities) {
            const matchingBackends = version_backends.filter(vb => {
                const category = getBackendCategory(vb.backend)
                return category === priorityCategory
            })
             if (matchingBackends.length > 0) {
                 // If matches found, find the newest version among them
                 matchingBackends.sort((a, b) => b.version.localeCompare(a.version))
                 bestBackend = matchingBackends[0]
                 console.log(`Found best backend in category "${priorityCategory}": ${bestBackend.version}/${bestBackend.backend}`) // for debugging
                 break
             }
        }
        let defaultBackendString = ''
        if (bestBackend) {
            defaultBackendString = `${bestBackend.version}/${bestBackend.backend}`
        } else {
            console.warn('No supported backend found for this system') // for debugging, this will never be reached unless severe bug in extension
        }

        // Update the version_backend setting definition and set default if needed
        const backendSettingIndex = settings.findIndex(item => item.key === 'version_backend')
        if (backendSettingIndex !== -1) {
            const backendSetting = settings[backendSettingIndex]
            backendSetting.controllerProps.options = version_backends.map((b) => {
                const key = `${b.version}/${b.backend}`
                return { value: key, name: key }
            })
            // Get the currently saved value for version_backend
            const currentBackendSetting = await this.getSetting<string>('version_backend', backendSetting.controllerProps.value as string)
            const originalDefaultValue = SETTINGS.find(s => s.key === 'version_backend')?.controllerProps.value;
            if (!currentBackendSetting || currentBackendSetting === originalDefaultValue || currentBackendSetting === '') {
                if (defaultBackendString) {
                    backendSetting.controllerProps.value = defaultBackendString
                    console.log(`Setting default backend to: ${defaultBackendString}`)
                } else {
                    console.warn('Cannot set a default backend as none were found.')
                }
            } else {
                 console.log(`User-configured backend found: ${currentBackendSetting}`)
            }
        } else {
            console.error("Version backend setting definition not found in SETTINGS.")
        }


      }
    }
    this.autoUnload = await this.getSetting<boolean>('auto_unload_models', true)
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
    // Ensure the selected backend (either user's or default) is installed
    const selectedBackendSetting = this.config.version_backend
    if (selectedBackendSetting) {
        const [selectedVersion, selectedBackend] = selectedBackendSetting.split('/').map(part => part?.trim())
        if (selectedVersion && selectedBackend) {
            const isinstalled = await isBackendInstalled(selectedBackend, selectedVersion)
            if(!isinstalled) {
                await downloadBackend(selectedBackend, selectedVersion)
            }
        } else {
            console.warn(`Invalid backend setting format: ${selectedBackendSetting}`)
        }
    } else {
        console.warn('No backend selected or available to install.')
    }

    // Initialize models base path - assuming this would be retrieved from settings
    this.providerPath = await joinPath([
      await getJanDataFolderPath(),
      this.providerId,
    ])
  }

  async getProviderPath(): Promise<string> {
    if (!this.providerPath) {
      this.providerPath = await joinPath([
        await getJanDataFolderPath(),
        this.providerId,
      ])
    }
    return this.providerPath
  }

  override async onUnload(): Promise<void> {
    // Terminate all active sessions
    for (const [_, sInfo] of this.activeSessions) {
      try {
        await this.unload(sInfo.model_id)
      } catch (error) {
        console.error(`Failed to unload model ${sInfo.model_id}:`, error)
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
    const modelsDir = await joinPath([await this.getProviderPath(), 'models'])
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
      const path = await joinPath([modelsDir, modelId, 'model.yml'])
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
      await this.getProviderPath(),
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
    let mmprojPath = opts.mmprojPath
      ? await maybeDownload(opts.mmprojPath, 'mmproj.gguf')
      : undefined

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

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async waitForModelLoad(
    sInfo: SessionInfo,
    timeoutMs = 30_000
  ): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${sInfo.port}/health`)
        if (res.ok) {
          return
        }
      } catch (e) {}
      await this.sleep(500) // 500 sec interval during rechecks
    }
    await this.unload(sInfo.pid)
    throw new Error(`Timed out loading model after ${timeoutMs}... killing llamacpp`)
  }

  override async load(
    modelId: string,
    isEmbedding: boolean = false
  ): Promise<SessionInfo> {
    const sInfo = this.findSessionByModel(modelId)
    if (sInfo) {
      throw new Error('Model already loaded!!')
    }
    const loadedModels = await this.getLoadedModels()
    if (loadedModels.length > 0 && this.autoUnload) {
      // Unload all other models if auto-unload is enabled
      await Promise.all(
        loadedModels.map((loadedModel) => this.unload(loadedModel))
      )
    }
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
    args.push('--jinja')
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
    args.push('-ngl', String(cfg.n_gpu_layers > 0 ? cfg.n_gpu_layers : 100))
    if (cfg.threads > 0) args.push('--threads', String(cfg.threads))
    if (cfg.threads_batch > 0)
      args.push('--threads-batch', String(cfg.threads_batch))
    if (cfg.batch_size > 0) args.push('--batch-size', String(cfg.batch_size))
    if (cfg.ubatch_size > 0) args.push('--ubatch-size', String(cfg.ubatch_size))
    if (cfg.device.length > 0) args.push('--device', cfg.device)
    if (cfg.split_mode.length > 0) args.push('--split-mode', cfg.split_mode)
    if (cfg.main_gpu !== undefined)
      args.push('--main-gpu', String(cfg.main_gpu))

    // Boolean flags
    if (cfg.flash_attn) args.push('--flash-attn')
    if (cfg.cont_batching) args.push('--cont-batching')
    args.push('--no-mmap')
    if (cfg.mlock) args.push('--mlock')
    if (cfg.no_kv_offload) args.push('--no-kv-offload')
    if (isEmbedding) {
      args.push('--embedding')
      args.push('--pooling mean')
    } else {
      if (cfg.ctx_size > 0) args.push('--ctx-size', String(cfg.ctx_size))
      if (cfg.n_predict > 0) args.push('--n-predict', String(cfg.n_predict))
      args.push('--cache-type-k', cfg.cache_type_k)
      args.push('--cache-type-v', cfg.cache_type_v)
      args.push('--defrag-thold', String(cfg.defrag_thold))

      args.push('--rope-scaling', cfg.rope_scaling)
      args.push('--rope-scale', String(cfg.rope_scale))
      args.push('--rope-freq-base', String(cfg.rope_freq_base))
      args.push('--rope-freq-scale', String(cfg.rope_freq_scale))
      args.push('--reasoning-budget', String(cfg.reasoning_budget))
    }

    console.log('Calling Tauri command llama_load with args:', args)
    const backendPath = await getBackendExePath(backend, version)
    const libraryPath = await joinPath([await this.getProviderPath(), 'lib'])

    try {
      // TODO: add LIBRARY_PATH
      const sInfo = await invoke<SessionInfo>('load_llama_model', {
        backendPath,
        libraryPath,
        args,
      })

      // Store the session info for later use
      this.activeSessions.set(sInfo.pid, sInfo)
      await this.waitForModelLoad(sInfo)


      return sInfo
    } catch (error) {
      console.error('Error loading llama-server:', error)
      throw new Error(`Failed to load llama-server: ${error}`)
    }
  }

  override async unload(modelId: string): Promise<UnloadResult> {
    const sInfo: SessionInfo = this.findSessionByModel(modelId)
    if (!sInfo) {
      throw new Error(`No active session found for model: ${modelId}`)
    }
    const pid = sInfo.pid
    try {
      // Pass the PID as the session_id
      const result = await invoke<UnloadResult>('unload_llama_model', {
        pid: pid,
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
    const cleanModelId = modelId.includes('.')
      ? modelId.slice(0, modelId.indexOf('.'))
      : modelId
    return `${this.provider}/${cleanModelId}`
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
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
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

  private findSessionByModel(modelId: string): SessionInfo | undefined {
    return Array.from(this.activeSessions.values()).find(
      (session) => session.model_id === modelId
    )
  }

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const sessionInfo = this.findSessionByModel(opts.model)
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }
    const result = invoke<boolean>('is_process_running', { pid: sessionInfo.pid })
    if (!result) {
        throw new Error("Model have crashed! Please reload!")
    }
    const baseUrl = `http://localhost:${sessionInfo.port}/v1`
    const url = `${baseUrl}/chat/completions`
    console.log('Session Info:', sessionInfo, sessionInfo.api_key)
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
      signal: abortController?.signal,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
      )
    }

    return (await response.json()) as chatCompletion
  }

  override async delete(modelId: string): Promise<void> {
    const modelDir = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
    ])

    if (!(await fs.existsSync(await joinPath([modelDir, 'model.yml'])))) {
      throw new Error(`Model ${modelId} does not exist`)
    }

    await fs.rm(modelDir)
  }

  override async getLoadedModels(): Promise<string[]> {
    let lmodels: string[] = []
    for (const [_, sInfo] of this.activeSessions) {
      lmodels.push(sInfo.model_id)
    }
    return lmodels
  }

  async embed(text: string[]): Promise<EmbeddingResponse> {
    let sInfo = this.findSessionByModel('sentence-transformer-mini')
    if (!sInfo) {
      const downloadedModelList = await this.list()
      if (
        !downloadedModelList.some(
          (model) => model.id === 'sentence-transformer-mini'
        )
      ) {
        await this.import('sentence-transformer-mini', {
          modelPath:
            'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf?download=true',
        })
      }
      sInfo = await this.load('sentence-transformer-mini')
    }
    const baseUrl = `http://localhost:${sInfo.port}/v1/embeddings`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sInfo.api_key}`,
    }
    const body = JSON.stringify({
      input: text,
      model: sInfo.model_id,
      encoding_format: 'float',
    })
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
      )
    }
    const responseData = await response.json()
    return responseData as EmbeddingResponse
  }

  // Optional method for direct client access
  override getChatClient(sessionId: string): any {
    throw new Error('method not implemented yet')
  }
}
