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
} from '@janhq/core'

import { error, info, warn } from '@tauri-apps/plugin-log'
import { listen } from '@tauri-apps/api/event'

import {
  listSupportedBackends,
  downloadBackend,
  isBackendInstalled,
  getBackendExePath,
} from './backend'
import { invoke } from '@tauri-apps/api/core'
import { getProxyConfig } from './util'
import { basename } from '@tauri-apps/api/path'
import {
  GgufMetadata,
  readGgufMetadata,
} from '@janhq/tauri-plugin-llamacpp-api'
import { getSystemUsage } from '@janhq/tauri-plugin-hardware-api'

type LlamacppConfig = {
  version_backend: string
  auto_update_engine: boolean
  auto_unload: boolean
  llamacpp_env: string
  chat_template: string
  n_gpu_layers: number
  offload_mmproj: boolean
  override_tensor_buffer_t: string
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
  sha256?: string
  size?: number
}

interface ModelConfig {
  model_path: string
  mmproj_path?: string
  name: string // user-friendly
  // some model info that we cache upon import
  size_bytes: number
  sha256?: string
  mmproj_sha256?: string
  mmproj_size_bytes?: number
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
    this.llamacpp_env = this.config.llamacpp_env

    // This sets the base directory where model files for this provider are stored.
    this.providerPath = await joinPath([
      await getJanDataFolderPath(),
      this.providerId,
    ])

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

  private findLatestVersionForBackend(
    version_backends: { version: string; backend: string }[],
    backendType: string
  ): string | null {
    const matchingBackends = version_backends.filter(
      (vb) => vb.backend === backendType
    )
    if (matchingBackends.length === 0) {
      return null
    }

    // Sort by version (newest first) and get the latest
    matchingBackends.sort((a, b) => b.version.localeCompare(a.version))
    return `${matchingBackends[0].version}/${matchingBackends[0].backend}`
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

      if (storedBackendType) {
        // Find the latest version of the stored backend type
        const preferredBackendString = this.findLatestVersionForBackend(
          version_backends,
          storedBackendType
        )
        if (preferredBackendString) {
          bestAvailableBackendString = preferredBackendString
          logger.info(
            `Using stored backend preference: ${bestAvailableBackendString}`
          )
        } else {
          logger.warn(
            `Stored backend type '${storedBackendType}' not available, falling back to best backend`
          )
          // Clear the invalid stored preference
          this.clearStoredBackendType()
          bestAvailableBackendString =
            this.determineBestBackend(version_backends)
        }
      } else {
        bestAvailableBackendString = this.determineBestBackend(version_backends)
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
        // 2. Best available for stored backend type
        // 3. Original default
        let initialUiDefault = originalDefaultBackendValue

        if (
          savedBackendSetting &&
          savedBackendSetting !== originalDefaultBackendValue
        ) {
          initialUiDefault = savedBackendSetting
          // Store the backend type from the saved setting only if different
          const [, backendType] = savedBackendSetting.split('/')
          if (backendType) {
            const currentStoredBackend = this.getStoredBackendType()
            if (currentStoredBackend !== backendType) {
              this.setStoredBackendType(backendType)
              logger.info(
                `Stored backend type preference from saved setting: ${backendType}`
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
      try {
        const [bestVersion, bestBackend] = bestAvailableBackendString.split('/')

        // Download new backend
        await this.ensureBackendReady(bestBackend, bestVersion)

        // Add delay on Windows
        if (IS_WINDOWS) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }

        // Update configuration
        this.config.version_backend = bestAvailableBackendString

        // Store the backend type preference only if it changed
        const currentStoredBackend = this.getStoredBackendType()
        if (currentStoredBackend !== bestBackend) {
          this.setStoredBackendType(bestBackend)
          logger.info(`Stored new backend type preference: ${bestBackend}`)
        }

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
          `Successfully set initial backend: ${bestAvailableBackendString}`
        )
        return { wasUpdated: true, newBackend: bestAvailableBackendString }
      } catch (error) {
        logger.error('Failed to set initial backend:', error)
        return { wasUpdated: false, newBackend: this.config.version_backend }
      }
    }

    // Parse current backend configuration
    const [currentVersion, currentBackend] = (
      this.config.version_backend || ''
    ).split('/')

    if (!currentVersion || !currentBackend) {
      logger.warn(
        `Invalid current backend format: ${this.config.version_backend}`
      )
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }

    // Find the latest version for the currently selected backend type
    const version_backends = await listSupportedBackends()
    const targetBackendString = this.findLatestVersionForBackend(
      version_backends,
      currentBackend
    )

    if (!targetBackendString) {
      logger.warn(
        `No available versions found for current backend type: ${currentBackend}`
      )
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }

    const [latestVersion] = targetBackendString.split('/')

    // Check if update is needed (only version comparison for same backend type)
    if (currentVersion === latestVersion) {
      logger.info(
        'Auto-update: Already using the latest version of the selected backend'
      )
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }

    // Perform version update for the same backend type
    try {
      logger.info(
        `Auto-updating from ${this.config.version_backend} to ${targetBackendString} (preserving backend type)`
      )

      // Download new version of the same backend type
      await this.ensureBackendReady(currentBackend, latestVersion)

      // Add delay on Windows
      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // Update configuration
      this.config.version_backend = targetBackendString

      // Update stored backend type preference only if it changed
      const currentStoredBackend = this.getStoredBackendType()
      if (currentStoredBackend !== currentBackend) {
        this.setStoredBackendType(currentBackend)
        logger.info(`Updated stored backend type preference: ${currentBackend}`)
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

      logger.info(
        `Successfully updated to backend: ${targetBackendString} (preserved backend type: ${currentBackend})`
      )

      // Emit for updating fe
      if (events && typeof events.emit === 'function') {
        logger.info(
          `Emitting settingsChanged event for version_backend with value: ${targetBackendString}`
        )
        events.emit('settingsChanged', {
          key: 'version_backend',
          value: targetBackendString,
        })
      }

      // Clean up old versions of the same backend type
      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      await this.removeOldBackend(latestVersion, currentBackend)

      return { wasUpdated: true, newBackend: targetBackendString }
    } catch (error) {
      logger.error('Auto-update failed:', error)
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }
  }

  private async removeOldBackend(
    latestVersion: string,
    backendType: string
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
        const versionName = await basename(versionDir)

        // Skip the latest version
        if (versionName === latestVersion) {
          continue
        }

        // Check if this version has the specific backend type we're interested in
        const backendTypePath = await joinPath([versionPath, backendType])

        if (await fs.existsSync(backendTypePath)) {
          const isInstalled = await isBackendInstalled(backendType, versionName)
          if (isInstalled) {
            try {
              await fs.rm(backendTypePath)
              logger.info(
                `Removed old version of ${backendType}: ${backendTypePath}`
              )
            } catch (e) {
              logger.warn(
                `Failed to remove old backend version: ${backendTypePath}`,
                e
              )
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error during old backend version cleanup:', error)
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
      const [version, backend] = valueStr.split('/')

      // Store the backend type preference in localStorage only if it changed
      if (backend) {
        const currentStoredBackend = this.getStoredBackendType()
        if (currentStoredBackend !== backend) {
          this.setStoredBackendType(backend)
          logger.info(`Updated backend type preference to: ${backend}`)
        }
      }

      // Reset device setting when backend changes
      this.config.device = ''

      const closure = async () => {
        await this.ensureBackendReady(backend, version)
      }
      closure()
    } else if (key === 'auto_unload') {
      this.autoUnload = value as boolean
    } else if (key === 'llamacpp_env') {
      this.llamacpp_env = value as string
    }
  }

  private async generateApiKey(modelId: string, port: string): Promise<string> {
    const hash = await invoke<string>('plugin:llamacpp|generate_api_key', {
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
          events.emit('onFileDownloadUpdate', {
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

    try {
      // Validate main model file
      const modelMetadata = await readGgufMetadata(fullModelPath)
      logger.info(
        `Model GGUF validation successful: version ${modelMetadata.version}, tensors: ${modelMetadata.tensor_count}`
      )

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
    isEmbedding: boolean = false
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
      isEmbedding
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
    isEmbedding: boolean = false
  ): Promise<SessionInfo> {
    const loadedModels = await this.getLoadedModels()

    // Get OTHER models that are currently loading (exclude current model)
    const otherLoadingPromises = Array.from(this.loadingModels.entries())
      .filter(([id, _]) => id !== modelId)
      .map(([_, promise]) => promise)

    if (
      this.autoUnload &&
      (loadedModels.length > 0 || otherLoadingPromises.length > 0)
    ) {
      // Wait for OTHER loading models to finish, then unload everything
      if (otherLoadingPromises.length > 0) {
        await Promise.all(otherLoadingPromises)
      }

      // Now unload all loaded models
      const allLoadedModels = await this.getLoadedModels()
      if (allLoadedModels.length > 0) {
        await Promise.all(allLoadedModels.map((model) => this.unload(model)))
      }
    }
    const args: string[] = []
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

    // disable llama-server webui
    args.push('--no-webui')
    const api_key = await this.generateApiKey(modelId, String(port))
    envs['LLAMA_API_KEY'] = api_key

    // set user envs
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env)

    // model option is required
    // NOTE: model_path and mmproj_path can be either relative to Jan's data folder or absolute path
    const modelPath = await joinPath([
      janDataFolderPath,
      modelConfig.model_path,
    ])
    args.push('--jinja')
    args.push('-m', modelPath)
    // For overriding tensor buffer type, useful where
    // massive MOE models can be made faster by keeping attention on the GPU
    // and offloading the expert FFNs to the CPU.
    // This is an expert level settings and should only be used by people
    // who knows what they are doing.
    // Takes a regex with matching tensor name as input
    if (cfg.override_tensor_buffer_t)
      args.push('--override-tensor', cfg.override_tensor_buffer_t)
    // offload multimodal projector model to the GPU by default. if there is not enough memory
    // turn this setting off will keep the projector model on the CPU but the image processing can
    // take longer
    if (cfg.offload_mmproj === false) args.push('--no-mmproj-offload')
    args.push('-a', modelId)
    args.push('--port', String(port))
    if (modelConfig.mmproj_path) {
      const mmprojPath = await joinPath([
        janDataFolderPath,
        modelConfig.mmproj_path,
      ])
      args.push('--mmproj', mmprojPath)
    }
    // Add remaining options from the interface
    if (cfg.chat_template) args.push('--chat-template', cfg.chat_template)
    const gpu_layers =
      parseInt(String(cfg.n_gpu_layers)) >= 0 ? cfg.n_gpu_layers : 100
    args.push('-ngl', String(gpu_layers))
    if (cfg.threads > 0) args.push('--threads', String(cfg.threads))
    if (cfg.threads_batch > 0)
      args.push('--threads-batch', String(cfg.threads_batch))
    if (cfg.batch_size > 0) args.push('--batch-size', String(cfg.batch_size))
    if (cfg.ubatch_size > 0) args.push('--ubatch-size', String(cfg.ubatch_size))
    if (cfg.device.length > 0) args.push('--device', cfg.device)
    if (cfg.split_mode.length > 0 && cfg.split_mode != 'layer')
      args.push('--split-mode', cfg.split_mode)
    if (cfg.main_gpu !== undefined && cfg.main_gpu != 0)
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
      if (cfg.cache_type_k && cfg.cache_type_k != 'f16')
        args.push('--cache-type-k', cfg.cache_type_k)
      if (
        cfg.flash_attn &&
        cfg.cache_type_v != 'f16' &&
        cfg.cache_type_v != 'f32'
      ) {
        args.push('--cache-type-v', cfg.cache_type_v)
      }
      if (cfg.defrag_thold && cfg.defrag_thold != 0.1)
        args.push('--defrag-thold', String(cfg.defrag_thold))

      if (cfg.rope_scaling && cfg.rope_scaling != 'none')
        args.push('--rope-scaling', cfg.rope_scaling)
      if (cfg.rope_scale && cfg.rope_scale != 1)
        args.push('--rope-scale', String(cfg.rope_scale))
      if (cfg.rope_freq_base && cfg.rope_freq_base != 0)
        args.push('--rope-freq-base', String(cfg.rope_freq_base))
      if (cfg.rope_freq_scale && cfg.rope_freq_scale != 1)
        args.push('--rope-freq-scale', String(cfg.rope_freq_scale))
    }

    logger.info('Calling Tauri command llama_load with args:', args)
    const backendPath = await getBackendExePath(backend, version)
    const libraryPath = await joinPath([await this.getProviderPath(), 'lib'])

    try {
      // TODO: add LIBRARY_PATH
      const sInfo = await invoke<SessionInfo>(
        'plugin:llamacpp|load_llama_model',
        {
          backendPath,
          libraryPath,
          args,
          envs,
        }
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
      const result = await invoke<UnloadResult>(
        'plugin:llamacpp|unload_llama_model',
        {
          pid: pid,
        }
      )

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
      connectTimeout: 600000, // 10 minutes
      signal: AbortSignal.any([
        AbortSignal.timeout(600000),
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
    const libraryPath = await joinPath([await this.getProviderPath(), 'lib'])
    try {
      const dList = await invoke<DeviceList[]>('plugin:llamacpp|get_devices', {
        backendPath,
        libraryPath,
        envs,
      })
      return dList
    } catch (error) {
      logger.error('Failed to query devices:\n', error)
      throw new Error('Failed to load llamacpp backend')
    }
  }

  async embed(text: string[]): Promise<EmbeddingResponse> {
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
   *  estimate KVCache size of from a given metadata
   *
   */
  private async estimateKVCache(
    meta: Record<string, string>,
    ctx_size?: number
  ): Promise<number> {
    const arch = meta['general.architecture']
    if (!arch) throw new Error('Invalid metadata: architecture not found')

    const nLayer = Number(meta[`${arch}.block_count`])
    if (!nLayer) throw new Error('Invalid metadata: block_count not found')

    const nHead = Number(meta[`${arch}.attention.head_count`])
    if (!nHead) throw new Error('Invalid metadata: head_count not found')

    // Try to get key/value lengths first (more accurate)
    const keyLen = Number(meta[`${arch}.attention.key_length`])
    const valLen = Number(meta[`${arch}.attention.value_length`])

    let headDim: number

    if (keyLen && valLen) {
      // Use explicit key/value lengths if available
      logger.info(
        `Using explicit key_length: ${keyLen}, value_length: ${valLen}`
      )
      headDim = keyLen + valLen
    } else {
      // Fall back to embedding_length estimation
      const embeddingLen = Number(meta[`${arch}.embedding_length`])
      if (!embeddingLen)
        throw new Error('Invalid metadata: embedding_length not found')

      // Standard transformer: head_dim = embedding_dim / num_heads
      // For KV cache: we need both K and V, so 2 * head_dim per head
      headDim = (embeddingLen / nHead) * 2
      logger.info(
        `Using embedding_length estimation: ${embeddingLen}, calculated head_dim: ${headDim}`
      )
    }
    let ctxLen: number
    if (!ctx_size) {
      ctxLen = Number(meta[`${arch}.context_length`])
    } else {
      ctxLen = ctx_size
    }

    logger.info(`ctxLen: ${ctxLen}`)
    logger.info(`nLayer: ${nLayer}`)
    logger.info(`nHead: ${nHead}`)
    logger.info(`headDim: ${headDim}`)

    // Consider f16 by default
    // Can be extended by checking cache-type-v and cache-type-k
    // but we are checking overall compatibility with the default settings
    // fp16 = 8 bits * 2 = 16
    const bytesPerElement = 2

    // Total KV cache size per token = nHead * headDim * bytesPerElement
    const kvPerToken = nHead * headDim * bytesPerElement

    return ctxLen * nLayer * kvPerToken
  }

  private async getModelSize(path: string): Promise<number> {
    if (path.startsWith('https://')) {
      const res = await fetch(path, { method: 'HEAD' })
      const len = res.headers.get('content-length')
      return len ? parseInt(len, 10) : 0
    } else {
      return (await fs.fileStat(path)).size
    }
  }

  /*
   * check the support status of a model by its path (local/remote)
   *
   * * Returns:
   * - "RED"    → weights don't fit
   * - "YELLOW" → weights fit, KV cache doesn't
   * - "GREEN"  → both weights + KV cache fit
   */
  async isModelSupported(
    path: string,
    ctx_size?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN'> {
    try {
      const modelSize = await this.getModelSize(path)
      logger.info(`modelSize: ${modelSize}`)
      let gguf: GgufMetadata
      gguf = await readGgufMetadata(path)
      let kvCacheSize: number
      if (ctx_size) {
        kvCacheSize = await this.estimateKVCache(gguf.metadata, ctx_size)
      } else {
        kvCacheSize = await this.estimateKVCache(gguf.metadata)
      }
      // total memory consumption = model weights + kvcache + a small buffer for outputs
      // output buffer is small so not considering here
      const totalRequired = modelSize + kvCacheSize
      logger.info(
        `isModelSupported: Total memory requirement: ${totalRequired} for ${path}`
      )
      let totalMemBytes: number
      const devices = await this.getDevices()
      if (devices.length > 0) {
        // Sum total memory across all GPUs
        totalMemBytes = devices
          .map((d) => d.mem * 1024 * 1024)
          .reduce((a, b) => a + b, 0)
      } else {
        // CPU fallback
        const sys = await getSystemUsage()
        totalMemBytes = sys.total_memory * 1024 * 1024
      }

      // Use 80% of total memory as the usable limit
      const USABLE_MEMORY_PERCENTAGE = 0.8
      const usableMemBytes = totalMemBytes * USABLE_MEMORY_PERCENTAGE

      // check model size wrt 80% of system memory
      if (modelSize > usableMemBytes) {
        return 'RED'
      } else if (modelSize + kvCacheSize > usableMemBytes) {
        return 'YELLOW'
      } else {
        return 'GREEN'
      }
    } catch (e) {
      throw new Error(String(e))
    }
  }
}
