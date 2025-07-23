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

import { error, info, warn } from '@tauri-apps/plugin-log'

import {
  listSupportedBackends,
  downloadBackend,
  isBackendInstalled,
  getBackendExePath,
} from './backend'
import { invoke } from '@tauri-apps/api/core'
import { getProxyConfig } from './util'
import { basename } from '@tauri-apps/api/path'

type LlamacppConfig = {
  version_backend: string
  auto_update_engine: boolean
  auto_unload: boolean
  chat_template: string
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
  ctx_shift: boolean
}

interface DownloadItem {
  url: string
  save_path: string
  proxy?: Record<string, string | string[] | boolean>
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

interface DeviceList {
  id: string
  name: string
  mem: number
  free: number
}
/**
 * Override the default app.log function to use Jan's logging system.
 * @param args
 */
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
    error(args.map((arg) => ` ${arg}`).join(` `))
  },
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
  private activeSessions: Map<number, SessionInfo> = new Map()
  private providerPath!: string
  private apiSecret: string = 'JustAskNow'
  private pendingDownloads: Map<string, Promise<void>> = new Map()
  private isConfiguringBackends: boolean = false

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    let settings = structuredClone(SETTINGS) // Clone to modify settings definition before registration

    // This makes the settings (including the backend options and initial value) available to the Jan UI.
    this.registerSettings(settings)

    let loadedConfig: any = {}
    for (const item of settings) {
      const defaultValue = item.controllerProps.value
      // Use the potentially updated default value from the settings array as the fallback for getSetting
      loadedConfig[item.key] = await this.getSetting<typeof defaultValue>(
        item.key,
        defaultValue
      )
    }
    this.config = loadedConfig as LlamacppConfig

    // This sets the base directory where model files for this provider are stored.
    this.providerPath = await joinPath([
      await getJanDataFolderPath(),
      this.providerId,
    ])
    this.configureBackends()
  }

  async configureBackends(): Promise<void> {
    if (this.isConfiguringBackends) {
      logger.info(
        'configureBackends already in progress, skipping duplicate call'
      )
      return
    }

    this.isConfiguringBackends = true

    try {
      let version_backends: { version: string; backend: string }[] = []

      try {
        version_backends = await listSupportedBackends()
        if (version_backends.length === 0) {
          throw new Error(
            'No supported backend binaries found for this system. Backend selection and auto-update will be unavailable.'
          )
        } else {
          version_backends.sort((a, b) => b.version.localeCompare(a.version))
        }
      } catch (error) {
        throw new Error(
          `Failed to fetch supported backends: ${
            error instanceof Error ? error.message : error
          }`
        )
      }

      let bestAvailableBackendString =
        this.determineBestBackend(version_backends)

      let settings = structuredClone(SETTINGS)
      const backendSettingIndex = settings.findIndex(
        (item) => item.key === 'version_backend'
      )

      let originalDefaultBackendValue = ''
      if (backendSettingIndex !== -1) {
        const backendSetting = settings[backendSettingIndex]
        originalDefaultBackendValue = backendSetting.controllerProps
          .value as string

        backendSetting.controllerProps.options = version_backends.map((b) => {
          const key = `${b.version}/${b.backend}`
          return { value: key, name: key }
        })

        const savedBackendSetting = await this.getSetting<string>(
          'version_backend',
          originalDefaultBackendValue
        )

        const initialUiDefault =
          savedBackendSetting &&
          savedBackendSetting !== originalDefaultBackendValue
            ? savedBackendSetting
            : bestAvailableBackendString || originalDefaultBackendValue

        backendSetting.controllerProps.value = initialUiDefault
        logger.info(
          `Initial UI default for version_backend set to: ${initialUiDefault}`
        )
      } else {
        logger.error(
          'Critical setting "version_backend" definition not found in SETTINGS.'
        )
        throw new Error('Critical setting "version_backend" not found.')
      }

      this.registerSettings(settings)

      let effectiveBackendString = this.config.version_backend
      let backendWasDownloaded = false

      if (this.config.auto_update_engine) {
        const updateResult = await this.handleAutoUpdate(
          bestAvailableBackendString
        )
        if (updateResult.wasUpdated) {
          effectiveBackendString = updateResult.newBackend
          backendWasDownloaded = true
        }
      }

      if (!backendWasDownloaded) {
        await this.ensureFinalBackendInstallation(effectiveBackendString)
      } else {
        logger.info(
          'Skipping final installation check - backend was just downloaded during auto-update'
        )
      }
    } finally {
      this.isConfiguringBackends = false
    }
  }

  private determineBestBackend(
    version_backends: { version: string; backend: string }[]
  ): string {
    if (version_backends.length === 0) return ''

    // Priority list for backend types (more specific/performant ones first)
    const backendPriorities: string[] = [
      'cuda-cu12.0',
      'cuda-cu11.7',
      'vulkan',
      'avx512',
      'avx2',
      'avx',
      'noavx',
      'arm64',
      'x64',
    ]

    // Helper to map backend string to a priority category
    const getBackendCategory = (backendString: string): string | undefined => {
      if (backendString.includes('cu12.0')) return 'cuda-cu12.0'
      if (backendString.includes('cu11.7')) return 'cuda-cu11.7'
      if (backendString.includes('vulkan')) return 'vulkan'
      if (backendString.includes('avx512')) return 'avx512'
      if (backendString.includes('avx2')) return 'avx2'
      if (
        backendString.includes('avx') &&
        !backendString.includes('avx2') &&
        !backendString.includes('avx512')
      )
        return 'avx'
      if (backendString.includes('noavx')) return 'noavx'
      if (backendString.endsWith('arm64')) return 'arm64'
      if (backendString.endsWith('x64')) return 'x64'
      return undefined
    }

    let foundBestBackend: { version: string; backend: string } | undefined
    for (const priorityCategory of backendPriorities) {
      const matchingBackends = version_backends.filter((vb) => {
        const category = getBackendCategory(vb.backend)
        return category === priorityCategory
      })

      if (matchingBackends.length > 0) {
        foundBestBackend = matchingBackends[0]
        logger.info(
          `Determined best available backend: ${foundBestBackend.version}/${foundBestBackend.backend} (Category: "${priorityCategory}")`
        )
        break
      }
    }

    if (foundBestBackend) {
      return `${foundBestBackend.version}/${foundBestBackend.backend}`
    } else {
      // Fallback to newest version
      return `${version_backends[0].version}/${version_backends[0].backend}`
    }
  }

  private async handleAutoUpdate(
    bestAvailableBackendString: string
  ): Promise<{ wasUpdated: boolean; newBackend: string }> {
    logger.info(
      `Auto-update engine is enabled. Current backend: ${this.config.version_backend}. Best available: ${bestAvailableBackendString}`
    )

    if (!bestAvailableBackendString) {
      logger.warn(
        'Auto-update enabled, but no best available backend determined'
      )
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }

    const [currentVersion, currentBackend] = (
      this.config.version_backend || ''
    ).split('/')
    const [bestVersion, bestBackend] = bestAvailableBackendString.split('/')

    // Check if update is needed
    if (currentBackend === bestBackend && currentVersion === bestVersion) {
      logger.info('Auto-update: Already using the best available backend')
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }

    // Perform update
    try {
      logger.info(
        `Auto-updating from ${this.config.version_backend} to ${bestAvailableBackendString}`
      )

      // Download new backend first
      await this.ensureBackendReady(bestBackend, bestVersion)

      // Add a small delay on Windows to ensure file operations complete
      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // Update configuration
      this.config.version_backend = bestAvailableBackendString

      // Update settings
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (item.key === 'version_backend') {
            item.controllerProps.value = bestAvailableBackendString
          }
          return item
        })
      )

      logger.info(
        `Successfully updated to backend: ${bestAvailableBackendString}`
      )

      // Clean up old backends (with additional delay on Windows)
      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      await this.removeOldBackends(bestVersion, bestBackend)

      return { wasUpdated: true, newBackend: bestAvailableBackendString }
    } catch (error) {
      logger.error('Auto-update failed:', error)
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }
  }

  private async removeOldBackends(
    bestVersion: string,
    bestBackend: string
  ): Promise<void> {
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const backendsDir = await joinPath([
        janDataFolderPath,
        'llamacpp',
        'backends',
      ])

      if (!(await fs.existsSync(backendsDir))) {
        return
      }

      const versionDirs = await fs.readdirSync(backendsDir)

      for (const versionDir of versionDirs) {
        const versionPath = await joinPath([backendsDir, versionDir])
        const backendTypeDirs = await fs.readdirSync(versionPath)

        for (const backendTypeDir of backendTypeDirs) {
          const versionName = await basename(versionDir)
          const backendName = await basename(backendTypeDir)

          // Skip if it's the best version/backend
          if (versionName === bestVersion && backendName === bestBackend) {
            continue
          }

          // If this other backend is installed, remove it
          const isInstalled = await isBackendInstalled(backendName, versionName)
          if (isInstalled) {
            const toRemove = await joinPath([versionPath, backendTypeDir])
            try {
              await fs.rm(toRemove)
              logger.info(`Removed old backend: ${toRemove}`)
            } catch (e) {
              logger.warn(`Failed to remove old backend: ${toRemove}`, e)
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error during old backend cleanup:', error)
    }
  }

  private async ensureFinalBackendInstallation(
    backendString: string
  ): Promise<void> {
    if (!backendString) {
      logger.warn('No backend specified for final installation check')
      return
    }

    const [selectedVersion, selectedBackend] = backendString
      .split('/')
      .map((part) => part?.trim())

    if (!selectedVersion || !selectedBackend) {
      logger.warn(`Invalid backend format: ${backendString}`)
      return
    }

    try {
      const isInstalled = await isBackendInstalled(
        selectedBackend,
        selectedVersion
      )
      if (!isInstalled) {
        logger.info(`Final check: Installing backend ${backendString}`)
        await this.ensureBackendReady(selectedBackend, selectedVersion)
        logger.info(`Successfully installed backend: ${backendString}`)
      } else {
        logger.info(
          `Final check: Backend ${backendString} is already installed`
        )
      }
    } catch (error) {
      logger.error(
        `Failed to ensure backend ${backendString} installation:`,
        error
      )
      throw error // Re-throw as this is critical
    }
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
        logger.error(`Failed to unload model ${sInfo.model_id}:`, error)
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
        await this.ensureBackendReady(backend, version)
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
      await fs.mkdir(modelsDir)
    }

    await this.migrateLegacyModels()

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

  private async migrateLegacyModels() {
    const janDataFolderPath = await getJanDataFolderPath()
    const modelsDir = await joinPath([janDataFolderPath, 'models'])
    if (!(await fs.existsSync(modelsDir))) return

    // DFS
    let stack = [modelsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()

      const files = await fs.readdirSync(currentDir)
      for (const child of files) {
        const childPath = await joinPath([currentDir, child])
        const stat = await fs.fileStat(childPath)
        if (
          files.some((e) => e.endsWith('model.yml')) &&
          !child.endsWith('model.yml')
        )
          continue
        if (!stat.isDirectory && child.endsWith('.yml')) {
          // check if model.yml exists
          const modelConfigPath = child
          if (await fs.existsSync(modelConfigPath)) {
            const legacyModelConfig = await invoke<{
              files: string[]
              model: string
            }>('read_yaml', {
              path: modelConfigPath,
            })
            const legacyModelPath = legacyModelConfig.files?.[0]
            if (!legacyModelPath) continue
            // +1 to remove the leading slash
            // NOTE: this does not handle Windows path \\
            let modelId = currentDir.slice(modelsDir.length + 1)

            modelId =
              modelId !== 'imported'
                ? modelId
                : (await basename(child)).replace('.yml', '')

            const modelName = legacyModelConfig.model ?? modelId
            const configPath = await joinPath([
              await this.getProviderPath(),
              'models',
              modelId,
              'model.yml',
            ])
            if (await fs.existsSync(configPath)) continue // Don't reimport

            // this is relative to Jan's data folder
            const modelDir = `${this.providerId}/models/${modelId}`

            let size_bytes = (
              await fs.fileStat(
                await joinPath([janDataFolderPath, legacyModelPath])
              )
            ).size

            const modelConfig = {
              model_path: legacyModelPath,
              mmproj_path: undefined, // legacy models do not have mmproj
              name: modelName,
              size_bytes,
            } as ModelConfig
            await fs.mkdir(await joinPath([janDataFolderPath, modelDir]))
            await invoke<void>('write_yaml', {
              data: modelConfig,
              savePath: configPath,
            })
            continue
          }
        }
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
        downloadItems.push({
          url: path,
          save_path: localPath,
          proxy: getProxyConfig(),
        })
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
        logger.error('Error downloading model:', modelId, opts, error)
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
    timeoutMs = 240_000
  ): Promise<void> {
    await this.sleep(500) // Wait before first check
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${sInfo.port}/health`)

        if (res.status === 503) {
          const body = await res.json()
          const msg = body?.error?.message ?? 'Model loading'
          logger.info(`waiting for model load... (${msg})`)
        } else if (res.ok) {
          const body = await res.json()
          if (body.status === 'ok') {
            return
          } else {
            logger.warn('Unexpected OK response from /health:', body)
          }
        } else {
          logger.warn(`Unexpected status ${res.status} from /health`)
        }
      } catch (e) {
        await this.unload(sInfo.model_id)
        throw new Error(`Model appears to have crashed: ${e}`)
      }

      await this.sleep(800) // Retry interval
    }

    await this.unload(sInfo.model_id)
    throw new Error(
      `Timed out loading model after ${timeoutMs}... killing llamacpp`
    )
  }

  override async load(
    modelId: string,
    overrideSettings?: Partial<LlamacppConfig>,
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
    const cfg = { ...this.config, ...(overrideSettings ?? {}) }
    const [version, backend] = cfg.version_backend.split('/')
    if (!version || !backend) {
      throw new Error(
        `Invalid version/backend format: ${cfg.version_backend}. Expected format: <version>/<backend>`
      )
    }

    // Ensure backend is downloaded and ready before proceeding
    await this.ensureBackendReady(backend, version)

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
    args.push('--reasoning-format', 'none')
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
    if (cfg.chat_template) args.push('--chat-template', cfg.chat_template)
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
    if (!cfg.ctx_shift) args.push('--no-context-shift')
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
      if (
        (cfg.flash_attn && cfg.cache_type_v != 'f16') ||
        cfg.cache_type_v != 'f32'
      ) {
        args.push('--cache-type-v', cfg.cache_type_v)
      }
      args.push('--defrag-thold', String(cfg.defrag_thold))

      args.push('--rope-scaling', cfg.rope_scaling)
      args.push('--rope-scale', String(cfg.rope_scale))
      args.push('--rope-freq-base', String(cfg.rope_freq_base))
      args.push('--rope-freq-scale', String(cfg.rope_freq_scale))
    }

    logger.info('Calling Tauri command llama_load with args:', args)
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
      logger.error('Error loading llama-server:\n', error)
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
        logger.info(`Successfully unloaded model with PID ${pid}`)
      } else {
        logger.warn(`Failed to unload model: ${result.error}`)
      }

      return result
    } catch (error) {
      logger.error('Error in unload command:', error)
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

  private async ensureBackendReady(
    backend: string,
    version: string
  ): Promise<void> {
    const backendKey = `${version}/${backend}`

    // Check if backend is already installed
    const isInstalled = await isBackendInstalled(backend, version)
    if (isInstalled) {
      return
    }

    // Check if download is already in progress
    if (this.pendingDownloads.has(backendKey)) {
      logger.info(
        `Backend ${backendKey} download already in progress, waiting...`
      )
      await this.pendingDownloads.get(backendKey)
      return
    }

    // Start new download
    logger.info(`Backend ${backendKey} not installed, downloading...`)
    const downloadPromise = downloadBackend(backend, version).finally(() => {
      this.pendingDownloads.delete(backendKey)
    })

    this.pendingDownloads.set(backendKey, downloadPromise)
    await downloadPromise
    logger.info(`Backend ${backendKey} download completed`)
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

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let jsonStr = ''
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
            jsonStr = trimmedLine.slice(6)
          } else if (trimmedLine.startsWith('error: ')) {
            jsonStr = trimmedLine.slice(7)
            const error = JSON.parse(jsonStr)
            throw new Error(error.message)
          } else {
            // it should not normally reach here
            throw new Error('Malformed chunk')
          }
          try {
            const data = JSON.parse(jsonStr)
            const chunk = data as chatCompletionChunk
            yield chunk
          } catch (e) {
            logger.error('Error parsing JSON from stream or server error:', e)
            // re‑throw so the async iterator terminates with an error
            throw e
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
    // check if the process is alive
    const result = await invoke<boolean>('is_process_running', {
      pid: sessionInfo.pid,
    })
    if (result) {
      try {
        await fetch(`http://localhost:${sessionInfo.port}/health`)
      } catch (e) {
        this.unload(sessionInfo.model_id)
        throw new Error('Model appears to have crashed! Please reload!')
      }
    } else {
      this.activeSessions.delete(sessionInfo.pid)
      throw new Error('Model have crashed! Please reload!')
    }
    const baseUrl = `http://localhost:${sessionInfo.port}/v1`
    const url = `${baseUrl}/chat/completions`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionInfo.api_key}`,
    }

    const body = JSON.stringify(opts)
    if (opts.stream) {
      return this.handleStreamingResponse(url, headers, body, abortController)
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

  async getDevices(): Promise<DeviceList[]> {
    const cfg = this.config
    const [version, backend] = cfg.version_backend.split('/')
    if (!version || !backend) {
      throw new Error(
        `Invalid version/backend format: ${cfg.version_backend}. Expected format: <version>/<backend>`
      )
    }

    // Ensure backend is downloaded and ready before proceeding
    await this.ensureBackendReady(backend, version)
    logger.info('Calling Tauri command getDevices with arg --list-devices')
    const backendPath = await getBackendExePath(backend, version)
    const libraryPath = await joinPath([await this.getProviderPath(), 'lib'])
    try {
      const dList = await invoke<DeviceList[]>('get_devices', {
        backendPath,
        libraryPath,
      })
      return dList
    } catch (error) {
      logger.error('Failed to query devices:\n', error)
      throw new Error(`Failed to load llama-server: ${error}`)
    }
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
