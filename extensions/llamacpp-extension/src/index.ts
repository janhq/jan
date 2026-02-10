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
  AppEvent,
  DownloadEvent,
  chatCompletionRequestMessage,
} from '@janhq/core'

import { error, info, warn } from '@tauri-apps/plugin-log'
import { listen } from '@tauri-apps/api/event'
import {
  listSupportedBackends,
  downloadBackend,
  isBackendInstalled,
  getBackendExePath,
  getBackendDir,
} from './backend'
import { invoke } from '@tauri-apps/api/core'
import {
  getProxyConfig,
  buildEmbedBatches,
  mergeEmbedResponses,
  type EmbedBatchResult,
} from './util'
import { basename } from '@tauri-apps/api/path'
import {
  loadLlamaModel,
  readGgufMetadata,
  getModelSize,
  isModelSupported,
  unloadLlamaModel,
  LlamacppConfig,
  DownloadItem,
  ModelConfig,
  EmbeddingResponse,
  DeviceList,
  SystemMemory,
  mapOldBackendToNew,
  findLatestVersionForBackend,
  prioritizeBackends,
  checkBackendForUpdates,
  removeOldBackendVersions,
  shouldMigrateBackend,
  handleSettingUpdate,
} from '@janhq/tauri-plugin-llamacpp-api'
import { getSystemUsage, getSystemInfo } from '@janhq/tauri-plugin-hardware-api'

// Error message constant - matches web-app/src/utils/error.ts
const OUT_OF_CONTEXT_SIZE = 'the request exceeds the available context size.'

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
  timeout: number = 600
  llamacpp_env: string = ''
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private providerPath!: string
  private apiSecret: string = 'JustAskNow'
  private pendingDownloads: Map<string, Promise<void>> = new Map()
  private isConfiguringBackends: boolean = false
  private loadingModels = new Map<string, Promise<SessionInfo>>() // Track loading promises
  private unlistenValidationStarted?: () => void

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    let settings = structuredClone(SETTINGS) // Clone to modify settings definition before registration

    // Disable fit by default on macOS
    if (IS_MAC) {
      const fitSetting = settings.find((s: any) => s.key === 'fit')
      if (fitSetting) {
        fitSetting.controllerProps.value = false
      }
    }

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

    this.autoUnload = this.config.auto_unload
    this.timeout = this.config.timeout
    this.llamacpp_env = this.config.llamacpp_env

    // This sets the base directory where model files for this provider are stored.
    this.getProviderPath()

    // Set up validation event listeners to bridge Tauri events to frontend
    this.unlistenValidationStarted = await listen<{
      modelId: string
      downloadType: string
    }>('onModelValidationStarted', (event) => {
      console.debug(
        'LlamaCPP: bridging onModelValidationStarted event',
        event.payload
      )
      events.emit(DownloadEvent.onModelValidationStarted, event.payload)
    })

    this.configureBackends()
  }

  private getStoredBackendType(): string | null {
    try {
      return localStorage.getItem('llama_cpp_backend_type')
    } catch (error) {
      logger.warn('Failed to read backend type from localStorage:', error)
      return null
    }
  }

  private setStoredBackendType(backendType: string): void {
    try {
      localStorage.setItem('llama_cpp_backend_type', backendType)
      logger.info(`Stored backend type preference: ${backendType}`)
    } catch (error) {
      logger.warn('Failed to store backend type in localStorage:', error)
    }
  }

  private clearStoredBackendType(): void {
    try {
      localStorage.removeItem('llama_cpp_backend_type')
      logger.info('Cleared stored backend type preference')
    } catch (error) {
      logger.warn('Failed to clear backend type from localStorage:', error)
    }
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

      // Get stored backend preference
      const storedBackendType = this.getStoredBackendType()
      let bestAvailableBackendString = ''

      // Calculate the "best" backend first, as it's used for fallback and defaults
      bestAvailableBackendString =
        await this.determineBestBackend(version_backends)

      if (storedBackendType) {
        // Delegate migration check to Rust
        const migrationTarget = await shouldMigrateBackend(
          storedBackendType,
          version_backends
        )

        if (migrationTarget) {
          logger.info(
            `Migrating stored backend type preference from old '${storedBackendType}' to new common type: '${migrationTarget}'`
          )
          this.setStoredBackendType(migrationTarget)
        }

        const effectiveStoredBackendType = migrationTarget || storedBackendType

        // Use the effective (migrated) type to find the latest version
        const preferredBackendString = await findLatestVersionForBackend(
          version_backends,
          effectiveStoredBackendType
        )

        if (preferredBackendString) {
          // Override bestAvailableBackendString with the user preference
          // The returned string from Rust is "version/backend"
          bestAvailableBackendString = preferredBackendString
          logger.info(
            `Using stored backend preference: ${bestAvailableBackendString}`
          )
        } else {
          logger.warn(
            `Stored backend type '${effectiveStoredBackendType}' not available, falling back to best backend`
          )
          // Clear the invalid stored preference
          this.clearStoredBackendType()
          // bestAvailableBackendString remains as the priority one calculated earlier
        }
      }

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

        // Set the recommended backend based on bestAvailableBackendString
        if (bestAvailableBackendString) {
          backendSetting.controllerProps.recommended =
            bestAvailableBackendString
        }

        const savedBackendSetting = await this.getSetting<string>(
          'version_backend',
          originalDefaultBackendValue
        )

        // Determine initial UI default based on priority:
        // 1. Saved setting (if valid and not original default)
        // 2. Best available for stored backend type or automatic best
        // 3. Original default
        let initialUiDefault = originalDefaultBackendValue

        if (
          savedBackendSetting &&
          savedBackendSetting !== originalDefaultBackendValue
        ) {
          const [savedVersion, savedBackend] = savedBackendSetting.split('/')
          if (savedVersion && savedBackend) {
            // Map saved backend to new format if needed
            const normalizedBackend = await mapOldBackendToNew(savedBackend)
            initialUiDefault = `${savedVersion}/${normalizedBackend}`

            // Store the backend type from the saved setting only if different
            const currentStoredBackend = this.getStoredBackendType()
            if (currentStoredBackend !== normalizedBackend) {
              this.setStoredBackendType(normalizedBackend)
              logger.info(
                `Stored backend type preference from saved setting: ${normalizedBackend}`
              )
            }
          }
        } else if (bestAvailableBackendString) {
          initialUiDefault = bestAvailableBackendString
          // Store the backend type from the best available only if different
          const [, backendType] = bestAvailableBackendString.split('/')
          if (backendType) {
            const currentStoredBackend = this.getStoredBackendType()
            if (currentStoredBackend !== backendType) {
              this.setStoredBackendType(backendType)
              logger.info(
                `Stored backend type preference from best available: ${backendType}`
              )
            }
          }
        }

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

      // Handle fresh installation case where version_backend might be 'none' or invalid
      if (
        (!effectiveBackendString ||
          effectiveBackendString === 'none' ||
          !effectiveBackendString.includes('/') ||
          // If the selected backend is not in the list of supported backends
          // Need to reset too
          !version_backends.some(
            (e) => `${e.version}/${e.backend}` === effectiveBackendString
          )) &&
        // Ensure we have a valid best available backend
        bestAvailableBackendString
      ) {
        effectiveBackendString = bestAvailableBackendString
        logger.info(
          `Fresh installation or invalid backend detected, using: ${effectiveBackendString}`
        )

        // Update the config immediately
        this.config.version_backend = effectiveBackendString

        // Update the settings to reflect the change in UI
        const updatedSettings = await this.getSettings()
        await this.updateSettings(
          updatedSettings.map((item) => {
            if (item.key === 'version_backend') {
              item.controllerProps.value = effectiveBackendString
            }
            return item
          })
        )
        logger.info(`Updated UI settings to show: ${effectiveBackendString}`)

        // Emit for updating fe
        if (events && typeof events.emit === 'function') {
          logger.info(
            `Emitting settingsChanged event for version_backend with value: ${effectiveBackendString}`
          )
          events.emit('settingsChanged', {
            key: 'version_backend',
            value: effectiveBackendString,
          })
        }
      }

      // Download and install the backend if not already present
      if (effectiveBackendString) {
        const [version, backend] = effectiveBackendString.split('/')
        if (version && backend) {
          const isInstalled = await isBackendInstalled(backend, version)
          if (!isInstalled) {
            logger.info(`Installing initial backend: ${effectiveBackendString}`)
            await this.ensureBackendReady(backend, version)
            backendWasDownloaded = true
            logger.info(
              `Successfully installed initial backend: ${effectiveBackendString}`
            )
          }
        }
      }

      if (this.config.auto_update_engine) {
        const updateResult = await this.handleAutoUpdate(
          bestAvailableBackendString
        )
        if (updateResult.wasUpdated) {
          effectiveBackendString = updateResult.newBackend
          backendWasDownloaded = true
        }
      }

      if (!backendWasDownloaded && effectiveBackendString) {
        await this.ensureFinalBackendInstallation(effectiveBackendString)
      }
    } finally {
      this.isConfiguringBackends = false
    }
  }

  private async determineBestBackend(
    version_backends: { version: string; backend: string }[]
  ): Promise<string> {
    if (version_backends.length === 0) return ''

    // Check GPU memory availability via system info
    let hasEnoughGpuMemory = false
    try {
      const sysInfo = await getSystemInfo()
      for (const gpuInfo of sysInfo.gpus) {
        if (gpuInfo.total_memory >= 6 * 1024) {
          hasEnoughGpuMemory = true
          break
        }
      }
    } catch (error) {
      logger.warn('Failed to get system info for GPU memory check:', error)
      // Default to false if we can't determine GPU memory
      hasEnoughGpuMemory = false
    }

    // Use Rust logic to prioritize backends
    const result = await prioritizeBackends(
      version_backends,
      hasEnoughGpuMemory
    )
    return result.backend_string
  }

  async updateBackend(
    targetBackendString: string
  ): Promise<{ wasUpdated: boolean; newBackend: string }> {
    try {
      if (!targetBackendString)
        throw new Error(
          `Invalid backend string: ${targetBackendString} supplied to update function`
        )

      const [version, backend] = targetBackendString.split('/')

      logger.info(
        `Updating backend to ${targetBackendString} (backend type: ${backend})`
      )

      // Download new backend
      await this.ensureBackendReady(backend, version)

      // Add delay on Windows
      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // We ensure consistency by mapping the backend type, although targetBackendString should already be correct
      const effectiveBackendType = await mapOldBackendToNew(backend)
      const currentStoredBackend = this.getStoredBackendType()

      // Re-construct to be sure
      targetBackendString = `${version}/${effectiveBackendType}`

      // Update configuration
      this.config.version_backend = targetBackendString

      // Store the backend type preference only if it changed
      if (currentStoredBackend !== targetBackendString) {
        this.setStoredBackendType(targetBackendString)
        logger.info(
          `Updated stored backend type preference: ${targetBackendString}`
        )
      }

      // Update settings
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (item.key === 'version_backend') {
            item.controllerProps.value = targetBackendString
          }
          return item
        })
      )

      logger.info(`Successfully updated to backend: ${targetBackendString}`)

      // Emit for updating frontend
      if (events && typeof events.emit === 'function') {
        logger.info(
          `Emitting settingsChanged event for version_backend with value: ${targetBackendString}`
        )
        events.emit('settingsChanged', {
          key: 'version_backend',
          value: targetBackendString,
        })
      }

      // Clean up old versions of the same backend type using Rust command
      const janDataFolderPath = await getJanDataFolderPath()
      const backendsDir = await joinPath([
        janDataFolderPath,
        'llamacpp',
        'backends',
      ])

      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      await removeOldBackendVersions(backendsDir, version, backend)

      return { wasUpdated: true, newBackend: targetBackendString }
    } catch (error) {
      logger.error('Backend update failed:', error)
      return { wasUpdated: false, newBackend: this.config.version_backend }
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

    // If version_backend is empty, invalid, or 'none', use the best available backend
    if (
      !this.config.version_backend ||
      this.config.version_backend === '' ||
      this.config.version_backend === 'none' ||
      !this.config.version_backend.includes('/')
    ) {
      logger.info(
        'No valid backend currently selected, using best available backend'
      )

      return await this.updateBackend(bestAvailableBackendString)
    }

    // Use Rust checkBackendForUpdates logic implicitly here by using the helpers
    const version_backends = await listSupportedBackends()
    const checkResult = await checkBackendForUpdates(
      this.config.version_backend,
      version_backends
    )

    if (checkResult.update_needed && checkResult.target_backend) {
      logger.info(
        `Auto-updating to new version: ${checkResult.new_version} (${checkResult.target_backend})`
      )
      return await this.updateBackend(checkResult.target_backend)
    }

    // If no update needed, check if we need to fall back (e.g. current backend not supported anymore)
    // The Rust check_backend_for_updates handles finding the latest version for current type.
    // If it returns no target_backend, it means current type is not found.
    if (!checkResult.target_backend) {
      const [currentVersion, currentBackend] =
        this.config.version_backend.split('/')
      const currentEffectiveType = await mapOldBackendToNew(currentBackend)
      const bestEffectiveType = await mapOldBackendToNew(
        bestAvailableBackendString.split('/')[1]
      )

      if (currentEffectiveType !== bestEffectiveType) {
        logger.info(
          `Current backend type ${currentEffectiveType} not available, falling back to best available: ${bestAvailableBackendString}`
        )
        return await this.updateBackend(bestAvailableBackendString)
      }
    }

    return { wasUpdated: false, newBackend: this.config.version_backend }
  }

  async checkBackendForUpdates(): Promise<{
    updateNeeded: boolean
    newVersion: string
    targetBackend?: string
  }> {
    try {
      const version_backends = await listSupportedBackends()
      const result = await checkBackendForUpdates(
        this.config.version_backend,
        version_backends
      )

      return {
        updateNeeded: result.update_needed,
        newVersion: result.new_version,
        targetBackend: result.target_backend,
      }
    } catch (e) {
      logger.warn('Failed to check for updates via Rust command:', e)
      return { updateNeeded: false, newVersion: '0' }
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

    // Clean up validation event listeners
    if (this.unlistenValidationStarted) {
      this.unlistenValidationStarted()
    }
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value

    if (key === 'version_backend') {
      const valueStr = value as string
      // Async logic wrapped in IIFE since onSettingUpdate is void
      ;(async () => {
        try {
          const currentStored = this.getStoredBackendType() || undefined
          const result = await handleSettingUpdate(key, valueStr, currentStored)

          if (result.backend_type_updated && result.effective_backend_type) {
            this.setStoredBackendType(result.effective_backend_type)
            logger.info(
              `Updated backend type preference to: ${result.effective_backend_type}`
            )
          }

          if (result.version && result.backend) {
            this.config.device = ''
            await this.ensureBackendReady(result.backend, result.version)
          }
        } catch (e) {
          logger.error('Error in onSettingUpdate async block:', e)
        }
      })()
    } else if (key === 'auto_unload') {
      this.autoUnload = value as boolean
    } else if (key === 'llamacpp_env') {
      this.llamacpp_env = value as string
    } else if (key === 'timeout') {
      this.timeout = value as number
    }
  }

  private async generateApiKey(modelId: string, port: string): Promise<string> {
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

    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path,
    })

    const isEmbedding = await this.resolveEmbeddingConfig(modelId, modelConfig)

    return {
      id: modelId,
      name: modelConfig.name ?? modelId,
      quant_type: undefined, // TODO: parse quantization type from model.yml or model.gguf
      providerId: this.provider,
      port: 0, // port is not known until the model is loaded
      sizeBytes: modelConfig.size_bytes ?? 0,
      embedding: isEmbedding,
    } as modelInfo
  }

  /**
   * Checks if embedding status is known. If not, reads GGUF, detects it,
   * and updates the model.yml for future performance.
   */
  private async resolveEmbeddingConfig(
    modelId: string,
    modelConfig: ModelConfig
  ): Promise<boolean> {
    // Fast exit: if explicitly set in config, return it
    if (typeof modelConfig.embedding === 'boolean') {
      return modelConfig.embedding
    }

    // Migration logic: Detect from GGUF
    let isEmbedding = false
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const fullModelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])

      if (await fs.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath)
        // Check for BERT-based architectures usually used for embeddings
        // You can expand this list (e.g., 'nomic-bert', 'xlm-roberta')
        const arch = metadata.metadata['general.architecture']
        if (arch === 'bert' || arch === 'nomic-bert') {
          isEmbedding = true
        }
      }
    } catch (e) {
      // If GGUF read fails, default to false but log it
      logger.warn(`Failed to check metadata for ${modelId}`, e)
      return false
    }

    // Persist the result back to model.yml so we don't read GGUF next time
    try {
      const configPath = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
        'model.yml',
      ])

      // Update the local object
      modelConfig.embedding = isEmbedding

      // Write to disk
      await invoke<void>('write_yaml', {
        data: modelConfig,
        savePath: configPath,
      })
    } catch (e) {
      logger.warn(`Failed to update config for ${modelId}`, e)
    }

    return isEmbedding
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
      const isEmbedding = await this.resolveEmbeddingConfig(
        modelId,
        modelConfig
      )

      const capabilities: string[] = []
      if (modelConfig.mmproj_path) {
        capabilities.push('vision')
      }

      const modelInfo = {
        id: modelId,
        name: modelConfig.name ?? modelId,
        quant_type: undefined, // TODO: parse quantization type from model.yml or model.gguf
        providerId: this.provider,
        port: 0, // port is not known until the model is loaded
        sizeBytes: modelConfig.size_bytes ?? 0,
        embedding: isEmbedding,
        capabilities: capabilities.length > 0 ? capabilities : undefined,
      } as modelInfo
      modelInfos.push(modelInfo)
    }

    return modelInfos
  }

  private async migrateLegacyModels() {
    // Attempt to migrate only once
    if (localStorage.getItem('cortex_models_migrated') === 'true') return

    const janDataFolderPath = await getJanDataFolderPath()
    const modelsDir = await joinPath([janDataFolderPath, 'models'])
    if (!(await fs.existsSync(modelsDir))) return

    // DFS
    let stack = [modelsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()

      const files = await fs.readdirSync(currentDir)
      for (const child of files) {
        try {
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
                  ? modelId.replace(/^(cortex\.so|huggingface\.co)[\/\\]/, '')
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
        } catch (error) {
          console.error(`Error migrating model ${child}:`, error)
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
    localStorage.setItem('cortex_models_migrated', 'true')
  }

  /*
   * Manually installs a supported backend archive
   *
   */
  async installBackend(path: string): Promise<void> {
    const platformName = IS_WINDOWS ? 'win' : 'linux'

    // Match prefix (optional), llama, main (optional), version (b####-hash),
    // optional cudart-llama, bin, backend details
    // Examples:
    // - k_llama-main-b4314-09c61e1-bin-win-cuda-12.8-x64-avx2.zip
    // - ik_llama-main-b4314-09c61e1-cudart-llama-bin-win-cuda-12.8-x64-avx512.zip
    // - llama-b7037-bin-win-cuda-12.4-x64.zip (legacy format)
    const re =
      /^(.+?[-_])?llama(?:-main)?-(b\d+(?:-[a-f0-9]+)?)(?:-cudart-llama)?-bin-(.+?)\.(?:tar\.gz|zip)$/

    const archiveName = await basename(path)
    logger.info(`Installing backend from path: ${path}`)

    if (
      !(await fs.existsSync(path)) ||
      (!path.endsWith('tar.gz') && !path.endsWith('zip'))
    ) {
      logger.error(`Invalid path or file ${path}`)
      throw new Error(`Invalid path or file ${path}`)
    }

    const match = re.exec(archiveName)

    if (!match) {
      throw new Error(
        `Failed to parse archive name: ${archiveName}. Expected format: [Optional prefix-]llama-<version>-bin-<backend>.(tar.gz|zip)`
      )
    }

    const [, prefix, version, backend] = match

    if (!version || !backend) {
      throw new Error(`Invalid backend archive name: ${archiveName}`)
    }

    // Include prefix in the backend identifier if present
    const backendIdentifier = prefix ? `${prefix}${backend}` : backend

    logger.info(
      `Detected prefix: ${prefix || 'none'}, version: ${version}, backend: ${backendIdentifier}`
    )

    const backendDir = await getBackendDir(backendIdentifier, version)

    try {
      await invoke('decompress', { path: path, outputDir: backendDir })
    } catch (e) {
      logger.error(`Failed to install: ${String(e)}`)
      throw new Error(`Failed to decompress archive: ${String(e)}`)
    }

    const binPath =
      platformName === 'win'
        ? await joinPath([backendDir, 'build', 'bin', 'llama-server.exe'])
        : await joinPath([backendDir, 'build', 'bin', 'llama-server'])

    if (!fs.existsSync(binPath)) {
      await fs.rm(backendDir)
      throw new Error(
        'Not a supported backend archive! Missing llama-server binary.'
      )
    }

    try {
      await this.configureBackends()
      logger.info(
        `Backend ${backendIdentifier}/${version} installed and UI refreshed`
      )
    } catch (e) {
      logger.error('Backend installed but failed to refresh UI', e)
      throw new Error(
        `Backend installed but failed to refresh UI: ${String(e)}`
      )
    }
  }

  /**
   * Update a model with new information.
   * @param modelId
   * @param model
   */
  async update(modelId: string, model: Partial<modelInfo>): Promise<void> {
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
    // Check if newFolderPath exists
    if (await fs.existsSync(newFolderPath)) {
      throw new Error(`Model with ID ${model.id} already exists`)
    }
    const newModelConfigPath = await joinPath([newFolderPath, 'model.yml'])
    await fs.mv(modelFolderPath, newFolderPath).then(() =>
      // now replace what values have previous model name with format
      invoke('write_yaml', {
        data: {
          ...modelConfig,
          model_path: modelConfig?.model_path?.replace(
            `${this.providerId}/models/${modelId}`,
            `${this.providerId}/models/${model.id}`
          ),
          mmproj_path: modelConfig?.mmproj_path?.replace(
            `${this.providerId}/models/${modelId}`,
            `${this.providerId}/models/${model.id}`
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
          sha256:
            saveName === 'model.gguf' ? opts.modelSha256 : opts.mmprojSha256,
          size: saveName === 'model.gguf' ? opts.modelSize : opts.mmprojSize,
          model_id: modelId,
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
      try {
        // emit download update event on progress
        const onProgress = (transferred: number, total: number) => {
          events.emit(DownloadEvent.onFileDownloadUpdate, {
            modelId,
            percent: transferred / total,
            size: { transferred, total },
            downloadType: 'Model',
          })
        }
        const downloadManager = window.core.extensionManager.getByName(
          '@janhq/download-extension'
        )
        await downloadManager.downloadFiles(
          downloadItems,
          this.createDownloadTaskId(modelId),
          onProgress
        )

        // If we reach here, download completed successfully (including validation)
        // The downloadFiles function only returns successfully if all files downloaded AND validated
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
          modelId,
          downloadType: 'Model',
        })
      } catch (error) {
        logger.error('Error downloading model:', modelId, opts, error)
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        // Check if this is a cancellation
        const isCancellationError =
          errorMessage.includes('Download cancelled') ||
          errorMessage.includes('Validation cancelled') ||
          errorMessage.includes('Hash computation cancelled') ||
          errorMessage.includes('cancelled') ||
          errorMessage.includes('aborted')

        // Check if this is a validation failure
        const isValidationError =
          errorMessage.includes('Hash verification failed') ||
          errorMessage.includes('Size verification failed') ||
          errorMessage.includes('Failed to verify file')

        if (isCancellationError) {
          logger.info('Download cancelled for model:', modelId)
          // Emit download stopped event instead of error
          events.emit(DownloadEvent.onFileDownloadStopped, {
            modelId,
            downloadType: 'Model',
          })
        } else if (isValidationError) {
          logger.error(
            'Validation failed for model:',
            modelId,
            'Error:',
            errorMessage
          )

          // Cancel any other download tasks for this model
          try {
            this.abortImport(modelId)
          } catch (cancelError) {
            logger.warn('Failed to cancel download task:', cancelError)
          }

          // Emit validation failure event
          events.emit(DownloadEvent.onModelValidationFailed, {
            modelId,
            downloadType: 'Model',
            error: errorMessage,
            reason: 'validation_failed',
          })
        } else {
          // Regular download error
          events.emit(DownloadEvent.onFileDownloadError, {
            modelId,
            downloadType: 'Model',
            error: errorMessage,
          })
        }
        throw error
      }
    }

    // Validate GGUF files
    const janDataFolderPath = await getJanDataFolderPath()
    const fullModelPath = await joinPath([janDataFolderPath, modelPath])
    let isEmbedding = false

    try {
      // Validate main model file
      const modelMetadata = await readGgufMetadata(fullModelPath)
      logger.info(
        `Model GGUF validation successful: version ${modelMetadata.version}, tensors: ${modelMetadata.tensor_count}`
      )

      // check if the model is an embedding model
      const architecture = modelMetadata.metadata['general.architecture']
      if (architecture === 'bert' || architecture === 'nomic-bert') {
        isEmbedding = true
      }

      // Validate mmproj file if present
      if (mmprojPath) {
        const fullMmprojPath = await joinPath([janDataFolderPath, mmprojPath])
        const mmprojMetadata = await readGgufMetadata(fullMmprojPath)
        logger.info(
          `Mmproj GGUF validation successful: version ${mmprojMetadata.version}, tensors: ${mmprojMetadata.tensor_count}`
        )
      }
    } catch (error) {
      logger.error('GGUF validation failed:', error)
      throw new Error(
        `Invalid GGUF file(s): ${
          error.message || 'File format validation failed'
        }`
      )
    }

    // Calculate file sizes
    let size_bytes = (await fs.fileStat(fullModelPath)).size
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
      model_sha256: opts.modelSha256,
      model_size_bytes: opts.modelSize,
      mmproj_sha256: opts.mmprojSha256,
      mmproj_size_bytes: opts.mmprojSize,
      embedding: isEmbedding,
    } as ModelConfig
    await fs.mkdir(await joinPath([janDataFolderPath, modelDir]))
    await invoke<void>('write_yaml', {
      data: modelConfig,
      savePath: configPath,
    })
    events.emit(AppEvent.onModelImported, {
      modelId,
      modelPath,
      mmprojPath,
      size_bytes,
      model_sha256: opts.modelSha256,
      model_size_bytes: opts.modelSize,
      mmproj_sha256: opts.mmprojSha256,
      mmproj_size_bytes: opts.mmprojSize,
      embedding: isEmbedding,
    })
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

    // Delete the entire model folder if it exists (for validation failures)
    await this.deleteModelFolder(modelId)
  }

  /**
   * Function to find a random port
   */
  private async getRandomPort(): Promise<number> {
    try {
      const port = await invoke<number>('plugin:llamacpp|get_random_port')
      return port
    } catch {
      logger.error('Unable to find a suitable port')
      throw new Error('Unable to find a suitable port for model')
    }
  }

  private parseEnvFromString(
    target: Record<string, string>,
    envString: string
  ): void {
    envString
      .split(';')
      .filter((pair) => pair.trim())
      .forEach((pair) => {
        const [key, ...valueParts] = pair.split('=')
        const cleanKey = key?.trim()

        if (
          cleanKey &&
          valueParts.length > 0 &&
          !cleanKey.startsWith('LLAMA')
        ) {
          target[cleanKey] = valueParts.join('=').trim()
        }
      })
  }

  override async load(
    modelId: string,
    overrideSettings?: Partial<LlamacppConfig>,
    isEmbedding: boolean = false,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo> {
    const sInfo = await this.findSessionByModel(modelId)
    if (sInfo) {
      throw new Error('Model already loaded!!')
    }

    // If this model is already being loaded, return the existing promise
    if (this.loadingModels.has(modelId)) {
      return this.loadingModels.get(modelId)!
    }

    // Create the loading promise
    const loadingPromise = this.performLoad(
      modelId,
      overrideSettings,
      isEmbedding,
      bypassAutoUnload
    )
    this.loadingModels.set(modelId, loadingPromise)

    try {
      const result = await loadingPromise
      return result
    } finally {
      this.loadingModels.delete(modelId)
    }
  }

  private async performLoad(
    modelId: string,
    overrideSettings?: Partial<LlamacppConfig>,
    isEmbedding: boolean = false,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo> {
    const loadedModels = await this.getLoadedModels()

    // Get OTHER models that are currently loading (exclude current model)
    const otherLoadingPromises = Array.from(this.loadingModels.entries())
      .filter(([id, _]) => id !== modelId)
      .map(([_, promise]) => promise)

    if (
      this.autoUnload &&
      !isEmbedding &&
      !bypassAutoUnload &&
      (loadedModels.length > 0 || otherLoadingPromises.length > 0)
    ) {
      // Wait for OTHER loading models to finish, then unload everything
      if (otherLoadingPromises.length > 0) {
        await Promise.all(otherLoadingPromises)
      }

      // Now unload all loaded Text models excluding embedding models
      const allLoadedModels = await this.getLoadedModels()
      if (allLoadedModels.length > 0) {
        const sessionInfos: (SessionInfo | null)[] = await Promise.all(
          allLoadedModels.map(async (modelId) => {
            try {
              return await this.findSessionByModel(modelId)
            } catch (e) {
              logger.warn(`Unable to find session for model "${modelId}": ${e}`)
              return null
            }
          })
        )

        const nonEmbeddingModels: string[] = sessionInfos
          .filter(
            (s): s is SessionInfo => s !== null && s.is_embedding === false
          )
          .map((s) => s.model_id)

        if (nonEmbeddingModels.length > 0) {
          await Promise.all(
            nonEmbeddingModels.map((modelId) => this.unload(modelId))
          )
        }
      }
    }

    const envs: Record<string, string> = {}
    const cfg = { ...this.config, ...(overrideSettings ?? {}) }
    const [version, backend] = cfg.version_backend.split('/')

    if (!version || !backend) {
      throw new Error(
        'Initial setup for the backend failed due to a network issue. Please restart the app!'
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

    // Generate API key
    const api_key = await this.generateApiKey(modelId, String(port))
    envs['LLAMA_API_KEY'] = api_key
    envs['LLAMA_ARG_TIMEOUT'] = String(this.timeout)

    // Set user envs
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env)

    // Resolve model path
    const modelPath = await joinPath([
      janDataFolderPath,
      modelConfig.model_path,
    ])

    // Resolve mmproj path if present
    let mmprojPath: string | undefined = undefined
    if (modelConfig.mmproj_path) {
      mmprojPath = await joinPath([janDataFolderPath, modelConfig.mmproj_path])
    }

    // Migrate old env vars
    if(typeof cfg.fit === 'string') cfg.fit = true

    logger.info(
      'Calling Tauri command load_llama_model with config:',
      JSON.stringify(cfg)
    )
    const backendPath = await getBackendExePath(backend, version)

    try {
      const sInfo = await loadLlamaModel(
        backendPath,
        modelId,
        modelPath,
        port,
        cfg,
        envs,
        mmprojPath,
        isEmbedding,
        Number(this.timeout)
      )
      return sInfo
    } catch (error) {
      logger.error('Error in load command:\n', error)
      throw error
    }
  }

  override async unload(modelId: string): Promise<UnloadResult> {
    const sInfo: SessionInfo = await this.findSessionByModel(modelId)
    if (!sInfo) {
      throw new Error(`No active session found for model: ${modelId}`)
    }
    const pid = sInfo.pid
    try {
      // Pass the PID as the session_id
      const result = await unloadLlamaModel(pid)

      // If successful, remove from active sessions
      if (result.success) {
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
      connectTimeout: Number(this.timeout) * 1000, // default 10 minutes
      signal: AbortSignal.any([
        AbortSignal.timeout(this.timeout * 1000),
        abortController?.signal,
      ]),
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

            // Check for out-of-context error conditions
            if (chunk.choices?.[0]?.finish_reason === 'length') {
              // finish_reason 'length' indicates context limit was hit
              throw new Error(OUT_OF_CONTEXT_SIZE)
            }

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

  private async findSessionByModel(modelId: string): Promise<SessionInfo> {
    try {
      let sInfo = await invoke<SessionInfo>(
        'plugin:llamacpp|find_session_by_model',
        {
          modelId,
        }
      )
      return sInfo
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
      throw new Error(`No active session found for model: ${opts.model}`)
    }
    // check if the process is alive
    const result = await invoke<boolean>('plugin:llamacpp|is_process_running', {
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
      throw new Error('Model have crashed! Please reload!')
    }
    const baseUrl = `http://localhost:${sessionInfo.port}/v1`
    const url = `${baseUrl}/chat/completions`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionInfo.api_key}`,
    }
    // always enable prompt progress return if stream is true
    // Requires llamacpp version > b6399
    // Example json returned from server
    // {"choices":[{"finish_reason":null,"index":0,"delta":{"role":"assistant","content":null}}],"created":1758113912,"id":"chatcmpl-UwZwgxQKyJMo7WzMzXlsi90YTUK2BJro","model":"qwen","system_fingerprint":"b1-e4912fc","object":"chat.completion.chunk","prompt_progress":{"total":36,"cache":0,"processed":36,"time_ms":5706760300}}
    // (chunk.prompt_progress?.processed / chunk.prompt_progress?.total) * 100
    // chunk.prompt_progress?.cache is for past tokens already in kv cache
    opts.return_progress = true

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

    const completionResponse = (await response.json()) as chatCompletion

    // Check for out-of-context error conditions
    if (completionResponse.choices?.[0]?.finish_reason === 'length') {
      // finish_reason 'length' indicates context limit was hit
      throw new Error(OUT_OF_CONTEXT_SIZE)
    }

    return completionResponse
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
    try {
      let models: string[] = await invoke<string[]>(
        'plugin:llamacpp|get_loaded_models'
      )
      return models
    } catch (e) {
      logger.error(e)
      throw new Error(e)
    }
  }

  /**
   * Check if mmproj.gguf file exists for a given model ID
   * @param modelId - The model ID to check for mmproj.gguf
   * @returns Promise<boolean> - true if mmproj.gguf exists, false otherwise
   */
  async checkMmprojExists(modelId: string): Promise<boolean> {
    try {
      const modelConfigPath = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
        'model.yml',
      ])

      const modelConfig = await invoke<ModelConfig>('read_yaml', {
        path: modelConfigPath,
      })

      // If mmproj_path is not defined in YAML, return false
      if (modelConfig.mmproj_path) {
        return true
      }

      const mmprojPath = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
        'mmproj.gguf',
      ])
      return await fs.existsSync(mmprojPath)
    } catch (e) {
      logger.error(`Error checking mmproj.gguf for model ${modelId}:`, e)
      return false
    }
  }

  async getDevices(): Promise<DeviceList[]> {
    const cfg = this.config
    const [version, backend] = cfg.version_backend.split('/')
    if (!version || !backend) {
      throw new Error(
        'Backend setup was not successful. Please restart the app in a stable internet connection.'
      )
    }
    // set envs
    const envs: Record<string, string> = {}
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env)

    // Ensure backend is downloaded and ready before proceeding
    await this.ensureBackendReady(backend, version)
    logger.info('Calling Tauri command getDevices with arg --list-devices')
    const backendPath = await getBackendExePath(backend, version)

    try {
      const dList = await invoke<DeviceList[]>('plugin:llamacpp|get_devices', {
        backendPath,
        envs,
      })
      // On Linux with AMD GPUs, llama.cpp via Vulkan may report UMA (shared) memory as device-local.
      // For clearer UX, override with dedicated VRAM from the hardware plugin when available.
      try {
        const sysInfo = await getSystemInfo()
        if (sysInfo?.os_type === 'linux' && Array.isArray(sysInfo.gpus)) {
          const usage = await getSystemUsage()
          if (usage && Array.isArray(usage.gpus)) {
            const uuidToUsage: Record<
              string,
              { total_memory: number; used_memory: number }
            > = {}
            for (const u of usage.gpus as any[]) {
              if (u && typeof u.uuid === 'string') {
                uuidToUsage[u.uuid] = u
              }
            }

            const indexToAmdUuid = new Map<number, string>()
            for (const gpu of sysInfo.gpus as any[]) {
              const vendorStr =
                typeof gpu?.vendor === 'string'
                  ? gpu.vendor
                  : typeof gpu?.vendor === 'object' && gpu.vendor !== null
                    ? String(gpu.vendor)
                    : ''
              if (
                vendorStr.toUpperCase().includes('AMD') &&
                gpu?.vulkan_info &&
                typeof gpu.vulkan_info.index === 'number' &&
                typeof gpu.uuid === 'string'
              ) {
                indexToAmdUuid.set(gpu.vulkan_info.index, gpu.uuid)
              }
            }

            if (indexToAmdUuid.size > 0) {
              const adjusted = dList.map((dev) => {
                if (dev.id?.startsWith('Vulkan')) {
                  const match = /^Vulkan(\d+)/.exec(dev.id)
                  if (match) {
                    const vIdx = Number(match[1])
                    const uuid = indexToAmdUuid.get(vIdx)
                    if (uuid) {
                      const u = uuidToUsage[uuid]
                      if (
                        u &&
                        typeof u.total_memory === 'number' &&
                        typeof u.used_memory === 'number'
                      ) {
                        const total = Math.max(0, Math.floor(u.total_memory))
                        const free = Math.max(
                          0,
                          Math.floor(u.total_memory - u.used_memory)
                        )
                        return { ...dev, mem: total, free }
                      }
                    }
                  }
                }
                return dev
              })
              return adjusted
            }
          }
        }
      } catch (e) {
        logger.warn('Device memory override (AMD/Linux) failed:', e)
      }

      return dList
    } catch (error) {
      logger.error('Failed to query devices:\n', error)
      throw new Error('Failed to load llamacpp backend')
    }
  }

  async embed(text: string[]): Promise<EmbeddingResponse> {
    // Ensure the sentence-transformer model is present
    let sInfo = await this.findSessionByModel('sentence-transformer-mini')
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
      // Load specifically in embedding mode
      sInfo = await this.load('sentence-transformer-mini', undefined, true)
    }

    const ubatchSize =
      (this.config?.ubatch_size && this.config.ubatch_size > 0
        ? this.config.ubatch_size
        : 512) || 512
    const batches = buildEmbedBatches(text, ubatchSize)

    const attemptRequest = async (
      session: SessionInfo,
      batchInput: string[]
    ) => {
      const baseUrl = `http://localhost:${session.port}/v1/embeddings`
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.api_key}`,
      }
      const body = JSON.stringify({
        input: batchInput,
        model: session.model_id,
        encoding_format: 'float',
      })
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body,
      })
      return response
    }

    const sendBatch = async (batchInput: string[]) => {
      let response = await attemptRequest(sInfo as SessionInfo, batchInput)

      // If embeddings endpoint is not available (501), reload with embedding mode and retry once
      if (response.status === 501) {
        try {
          await this.unload('sentence-transformer-mini')
        } catch {}
        sInfo = await this.load('sentence-transformer-mini', undefined, true)
        response = await attemptRequest(sInfo as SessionInfo, batchInput)
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(
          `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
        )
      }
      const responseData = (await response.json()) as EmbedBatchResult
      return responseData
    }

    const batchResults: Array<{ result: EmbedBatchResult; offset: number }> = []
    for (const { batch, offset } of batches) {
      const result = await sendBatch(batch)
      batchResults.push({ result, offset })
    }

    return mergeEmbedResponses(
      (sInfo as SessionInfo).model_id,
      batchResults
    ) as EmbeddingResponse
  }

  /**
   * Check if a tool is supported by the model
   * Currently read from GGUF chat_template
   * @param modelId
   * @returns
   */
  async isToolSupported(modelId: string): Promise<boolean> {
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
    // model option is required
    // NOTE: model_path and mmproj_path can be either relative to Jan's data folder or absolute path
    const modelPath = await joinPath([
      janDataFolderPath,
      modelConfig.model_path,
    ])
    return (await readGgufMetadata(modelPath)).metadata?.[
      'tokenizer.chat_template'
    ]?.includes('tools')
  }

  /**
   * Check the support status of a model by its path (local/remote)
   *
   * Returns:
   * - "RED"    → weights don't fit in total memory
   * - "YELLOW" → weights fit in VRAM but need system RAM, or KV cache doesn't fit
   * - "GREEN"  → both weights + KV cache fit in VRAM
   */
  async isModelSupported(
    path: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN'> {
    try {
      const result = await isModelSupported(path, Number(ctxSize))
      return result
    } catch (e) {
      throw new Error(String(e))
    }
  }

  /**
   * Validate GGUF file and check for unsupported architectures like CLIP
   */
  async validateGgufFile(filePath: string): Promise<{
    isValid: boolean
    error?: string
    metadata?: any
  }> {
    try {
      logger.info(`Validating GGUF file: ${filePath}`)
      const metadata = await readGgufMetadata(filePath)

      // Log full metadata for debugging
      logger.info('Full GGUF metadata:', JSON.stringify(metadata, null, 2))

      // Check if architecture is 'clip' which is not supported for text generation
      const architecture = metadata.metadata?.['general.architecture']
      logger.info(`Model architecture: ${architecture}`)

      if (architecture === 'clip') {
        const errorMessage =
          'This model has CLIP architecture and cannot be imported as a text generation model. CLIP models are designed for vision tasks and require different handling.'
        logger.error('CLIP architecture detected:', architecture)
        return {
          isValid: false,
          error: errorMessage,
          metadata,
        }
      }

      logger.info('Model validation passed. Architecture:', architecture)
      return {
        isValid: true,
        metadata,
      }
    } catch (error) {
      logger.error('Failed to validate GGUF file:', error)
      return {
        isValid: false,
        error: `Failed to read model metadata: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      }
    }
  }

  async getTokensCount(opts: chatCompletionRequest): Promise<number> {
    const sessionInfo = await this.findSessionByModel(opts.model)
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }

    // Check if the process is alive
    const result = await invoke<boolean>('plugin:llamacpp|is_process_running', {
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
      throw new Error('Model has crashed! Please reload!')
    }

    const baseUrl = `http://localhost:${sessionInfo.port}`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionInfo.api_key}`,
    }

    // Count image tokens first
    let imageTokens = 0
    const hasImages = opts.messages.some(
      (msg) =>
        Array.isArray(msg.content) &&
        msg.content.some((content) => content.type === 'image_url')
    )

    if (hasImages) {
      logger.info('Conversation has images')
      try {
        // Read mmproj metadata to get vision parameters
        logger.info(`MMPROJ PATH: ${sessionInfo.mmproj_path}`)

        const metadata = await readGgufMetadata(sessionInfo.mmproj_path)
        logger.info(`mmproj metadata: ${JSON.stringify(metadata.metadata)}`)
        imageTokens = await this.calculateImageTokens(
          opts.messages,
          metadata.metadata
        )
      } catch (error) {
        logger.warn('Failed to calculate image tokens:', error)
        // Fallback to a rough estimate if metadata reading fails
        imageTokens = this.estimateImageTokensFallback(opts.messages)
      }
    }

    // Calculate text tokens
    // Use chat_template_kwargs from opts if provided, otherwise default to disable enable_thinking
    const tokenizeRequest = {
      messages: opts.messages,
      chat_template_kwargs: opts.chat_template_kwargs || {
        enable_thinking: false,
      },
    }

    try {
      let parseResponse = await fetch(`${baseUrl}/apply-template`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(tokenizeRequest),
      })

      if (!parseResponse.ok) {
        const errorData = await parseResponse.json().catch(() => null)
        throw new Error(
          `API request failed with status ${
            parseResponse.status
          }: ${JSON.stringify(errorData)}`
        )
      }

      const parsedPrompt = await parseResponse.json()

      const response = await fetch(`${baseUrl}/tokenize`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          content: parsedPrompt.prompt,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(
          `API request failed with status ${response.status}: ${JSON.stringify(
            errorData
          )}`
        )
      }

      const dataTokens = await response.json()
      const textTokens = dataTokens.tokens?.length || 0

      return textTokens + imageTokens
    } catch (e) {
      console.warn(String(e))
    }
    return 0
  }

  private async calculateImageTokens(
    messages: chatCompletionRequestMessage[],
    metadata: Record<string, string>
  ): Promise<number> {
    // Extract vision parameters from metadata
    const projectionDim =
      Math.floor(Number(metadata['clip.vision.projection_dim']) / 10) || 256

    // Count images in messages
    let imageCount = 0
    for (const message of messages) {
      if (Array.isArray(message.content)) {
        imageCount += message.content.filter(
          (content) => content.type === 'image_url'
        ).length
      }
    }

    logger.info(
      `Calculated ${projectionDim} tokens per image, ${imageCount} images total`
    )
    return projectionDim * imageCount - imageCount // remove the lingering <__image__> placeholder token
  }

  private estimateImageTokensFallback(
    messages: chatCompletionRequestMessage[]
  ): number {
    // Fallback estimation if metadata reading fails
    const estimatedTokensPerImage = 256 // Gemma's siglip

    let imageCount = 0
    for (const message of messages) {
      if (Array.isArray(message.content)) {
        imageCount += message.content.filter(
          (content) => content.type === 'image_url'
        ).length
      }
    }

    logger.warn(
      `Fallback estimation: ${estimatedTokensPerImage} tokens per image, ${imageCount} images total`
    )
    return imageCount * estimatedTokensPerImage - imageCount // remove the lingering <__image__> placeholder token
  }
}
