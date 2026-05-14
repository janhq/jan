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
  verifyBackendInstallation,
  getBackendExePath,
  getBackendDir,
} from './backend'
import { invoke } from '@tauri-apps/api/core'
import {
  getProxyConfig,
  buildEmbedBatches,
  mergeEmbedResponses,
  detectEmbeddingFromGgufMeta,
  getDefaultEmbeddingModelId,
  setDefaultEmbeddingModelId,
  type EmbedBatchResult,
} from './util'
import { generatePreset } from './preset'
import { basename } from '@tauri-apps/api/path'
import {
  loadLlamaModel,
  readGgufMetadata,
  isModelSupported,
  scoreHubModel,
  unloadLlamaModel,
  LlamacppConfig,
  DownloadItem,
  ModelConfig,
  EmbeddingResponse,
  ModelProps,
  DeviceList,
  HubModelScoreRequest,
  HubModelScoreResult,
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

const EMBEDDING_CHECK_VERSION = 3

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

/**
 * Parse the build number from a llama.cpp version string like "b6325".
 * Returns the numeric portion, or null if the format doesn't match.
 */
function parseBuildNumber(version: string): number | null {
  const match = version.match(/^b(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}

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
  timeout: number = 600
  llamacpp_env: string = ''
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private providerPath!: string
  private apiSecret: string = 'JustAskNow'
  private pendingDownloads: Map<string, Promise<void>> = new Map()
  private isConfiguringBackends: boolean = false
  private isUpdatingBackend: boolean = false
  private loadingModels = new Map<string, Promise<SessionInfo>>() // Track loading promises
  private unlistenValidationStarted?: () => void

  private routerPort?: number
  private routerApiKey?: string
  private userModelsMax: number = 1
  private loadedChatOrder: string[] = []

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    let settings = structuredClone(SETTINGS) // Clone to modify settings definition before registration

    if (!IS_MAC) {
      const fitItem = settings.find((s) => s.key === 'fit')
      if (fitItem) fitItem.controllerProps.value = true
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

    // Migration v1: upgrade f16 KV cache defaults to q8_0
    await this.migrateKvCacheDefaults()

    // Migration v2: disable fit by default
    await this.migrateFitDefault()

    // Migration v3: enable fit on Windows/Linux with a discrete GPU
    await this.migrateFitPlatformDefault()

    await this.migrateAutoUnloadToModelsMax()

    this.timeout = this.config.timeout
    this.llamacpp_env = this.config.llamacpp_env

    // This sets the base directory where model files for this provider are stored.
    await this.getProviderPath()

    // Set up validation event listeners to bridge Tauri events to frontend
    this.unlistenValidationStarted = await listen<{
      modelId: string
      downloadType: string
    }>('onModelValidationStarted', (event) => {
      events.emit(DownloadEvent.onModelValidationStarted, event.payload)
    })

    // configureBackends is async; await it so the router has a backend to
    // launch. Failures here previously surfaced via unhandled rejection — the
    // try/catch below preserves that fail-soft behavior for the router step.
    try {
      await this.configureBackends()
    } catch (e) {
      logger.error('configureBackends failed during onLoad:', e)
    }

    try {
      await this.startRouter()
    } catch (e) {
      logger.error('Router failed to start during onLoad:', e)
    }
  }

  private async startRouter(): Promise<void> {
    const versionBackend = this.config?.version_backend
    if (
      !versionBackend ||
      versionBackend === 'none' ||
      !versionBackend.includes('/')
    ) {
      logger.info(
        'Router will start once backend is configured (no version_backend yet).'
      )
      return
    }

    const [version, backend] = versionBackend.split('/')
    if (!version || !backend) {
      logger.warn(
        `Skipping router start; malformed version_backend: ${versionBackend}`
      )
      return
    }

    const providerPath = await this.getProviderPath()
    const janDataFolderPath = await getJanDataFolderPath()
    const { path: presetPath, embeddingCount } = await generatePreset(
      providerPath,
      janDataFolderPath,
      this.config
    )

    const backendExe = await getBackendExePath(backend, version)
    const port = await this.getRandomPort()
    const apiKey = await this.generateApiKey('router', String(port))

    const envs: Record<string, string> = {}
    envs['LLAMA_API_KEY'] = apiKey
    envs['LLAMA_ARG_TIMEOUT'] = String(this.timeout)
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env)

    const rawMax = (this.config as any).models_max
    let modelsMax = 1
    if (typeof rawMax === 'number') modelsMax = rawMax
    else if (typeof rawMax === 'string' && rawMax.trim().length > 0) {
      const n = parseInt(rawMax, 10)
      if (!Number.isNaN(n) && n >= 0) modelsMax = n
    }
    // Reserve extra slots for embedding models so loading an embedder doesn't
    // evict the user's chat model. `models_max` governs chat models only;
    // Jan pre-evicts the oldest chat model in `performLoad` so the router's
    // LRU never picks the embedding. 0 (unlimited) stays unlimited.
    const userModelsMax = modelsMax
    this.userModelsMax = userModelsMax
    if (modelsMax > 0 && embeddingCount > 0) {
      modelsMax += embeddingCount
    }

    // Defensive: if a router is already running (hot reload / dev), stop it
    // first so start_router doesn't reject.
    try {
      const existing = await invoke<{ port: number; api_key: string } | null>(
        'plugin:llamacpp|get_router_info'
      )
      if (existing) {
        await invoke('plugin:llamacpp|stop_router').catch(() => undefined)
      }
    } catch {
      /* ignore probe failures */
    }

    const info = await invoke<{ port: number; api_key: string; pid: number }>(
      'plugin:llamacpp|start_router',
      {
        backendExe,
        presetPath,
        port,
        apiKey,
        modelsMax,
        defaultArgs: [] as string[],
        envs,
      }
    )

    this.routerPort = info.port
    this.routerApiKey = info.api_key
    logger.info(
      `Router started on port ${info.port} (pid ${info.pid}, models_max=${modelsMax} [user=${userModelsMax}, +${embeddingCount} embedding], preset=${presetPath})`
    )
  }

  /**
   * Public accessor for downstream consumers. Returns `null` if the router
   * hasn't been started successfully yet.
   */
  async getRouterInfo(): Promise<{ port: number; apiKey: string } | null> {
    if (this.routerPort != null && this.routerApiKey) {
      return { port: this.routerPort, apiKey: this.routerApiKey }
    }
    try {
      const info = await invoke<
        { port: number; api_key: string; pid: number } | null
      >('plugin:llamacpp|get_router_info')
      if (info) {
        this.routerPort = info.port
        this.routerApiKey = info.api_key
        return { port: info.port, apiKey: info.api_key }
      }
    } catch (e) {
      logger.warn('get_router_info failed:', e)
    }
    return null
  }

  /**
   * Fetch runtime properties for a loaded model from the router's
   * `/props?model=<id>` endpoint. Returns `undefined` if the router isn't
   * running, the model isn't loaded, or the response is unusable. `nCtx` is
   * the post-fit value — what `fit_ctx` settled on — so it's the right
   * denominator for the token-usage popup.
   */
  async getModelProps(modelId: string): Promise<ModelProps | undefined> {
    const router = await this.getRouterInfo()
    if (!router || !modelId) return undefined
    // Router runs with models_autoload=true, so `/props?model=X` against an
    // unloaded model would trigger a load. Gate on the loaded-set first.
    try {
      const loaded = await this.getLoadedModels()
      if (!loaded.includes(modelId)) return undefined
    } catch {
      return undefined
    }
    try {
      const url = `http://127.0.0.1:${router.port}/props?model=${encodeURIComponent(modelId)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${router.apiKey}` },
      })
      if (!res.ok) return undefined
      const json = (await res.json()) as {
        default_generation_settings?: { n_ctx?: number }
        total_slots?: number
        model_alias?: string
        is_sleeping?: boolean
      }
      const n = json?.default_generation_settings?.n_ctx
      if (typeof n !== 'number' || n <= 0) return undefined
      return {
        nCtx: n,
        totalSlots:
          typeof json.total_slots === 'number' ? json.total_slots : undefined,
        modelAlias: json.model_alias,
        isSleeping: !!json.is_sleeping,
      }
    } catch {
      return undefined
    }
  }

  private async readMmprojCapabilities(
    mmprojPath: string
  ): Promise<{ vision: boolean; audio: boolean }> {
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const fullPath = await joinPath([janDataFolderPath, mmprojPath])
      const meta = (await readGgufMetadata(fullPath)).metadata ?? {}
      const truthy = (v: string | undefined) =>
        typeof v === 'string' && v.toLowerCase() === 'true'
      const vision = truthy(meta['clip.has_vision_encoder'])
      const audio = truthy(meta['clip.has_audio_encoder'])
      if (!vision && !audio) return { vision: true, audio: false }
      return { vision, audio }
    } catch (error) {
      logger.warn('Failed to read mmproj capabilities:', error)
      return { vision: true, audio: false }
    }
  }

  private async migrateAutoUnloadToModelsMax(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_models_max_migrated_v1'
    if (localStorage.getItem(MIGRATION_KEY)) return

    try {
      const old = await this.getSetting<boolean | undefined>(
        'auto_unload',
        undefined
      )
      if (old !== undefined) {
        const targetValue = old ? '1' : '0'
        const settings = await this.getSettings()
        await this.updateSettings(
          settings.map((item) => {
            if (item.key === 'models_max') {
              item.controllerProps.value = targetValue
            }
            return item
          })
        )
        ;(this.config as any).models_max = targetValue
        logger.info(
          `Migrated auto_unload=${old} -> models_max=${targetValue}`
        )
      }
    } catch (e) {
      logger.warn('migrateAutoUnloadToModelsMax failed:', e)
      return
    }

    localStorage.setItem(MIGRATION_KEY, '1')
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

  private async migrateKvCacheDefaults(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_kv_cache_migrated_v1'
    if (localStorage.getItem(MIGRATION_KEY)) return

    const keysToMigrate = ['cache_type_k', 'cache_type_v'] as const
    const needsMigration = keysToMigrate.some(
      (k) => this.config[k] === 'f16'
    )

    if (needsMigration) {
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (
            keysToMigrate.includes(item.key as (typeof keysToMigrate)[number]) &&
            item.controllerProps.value === 'f16'
          ) {
            item.controllerProps.value = 'q8_0'
          }
          return item
        })
      )
      for (const k of keysToMigrate) {
        if (this.config[k] === 'f16') this.config[k] = 'q8_0'
      }
      logger.info('Migrated KV cache types from f16 to q8_0')
    }

    localStorage.setItem(MIGRATION_KEY, '1')
  }

  private async migrateFitDefault(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_fit_disabled_v1'
    if (localStorage.getItem(MIGRATION_KEY)) return

    if (this.config.fit === true) {
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (item.key === 'fit') {
            item.controllerProps.value = false
          }
          return item
        })
      )
      this.config.fit = false
      logger.info('Migrated fit setting: disabled by default')
    }

    localStorage.setItem(MIGRATION_KEY, '1')
  }

  private async migrateFitPlatformDefault(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_fit_platform_v2'
    if (localStorage.getItem(MIGRATION_KEY)) return

    if (IS_MAC) {
      localStorage.setItem(MIGRATION_KEY, '1')
      return
    }

    let hasDiscreteGpu = false
    try {
      const sysInfo = await getSystemInfo()
      hasDiscreteGpu = (sysInfo?.gpus ?? []).some(
        (g: any) =>
          g?.nvidia_info != null ||
          g?.vulkan_info?.device_type === 'DiscreteGpu'
      )
    } catch (error) {
      // Skip writing the migration key so a transient probe failure retries.
      logger.warn('Failed to probe GPU info for fit migration:', error)
      return
    }

    // Only upgrade the v1 auto-default; preserve any explicit user override.
    if (this.config.fit === false && hasDiscreteGpu) {
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (item.key === 'fit') {
            item.controllerProps.value = true
          }
          return item
        })
      )
      this.config.fit = true
      logger.info('Migrated fit setting: enabled (discrete GPU detected)')
    }

    localStorage.setItem(MIGRATION_KEY, '1')
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

      // Run dependency verification once after the backend is confirmed
      // installed. This covers both fresh downloads and pre-existing installs,
      // and runs only once per app startup via the isConfiguringBackends guard.
      if (effectiveBackendString) {
        // effectiveBackendString is expected to be "<version>/<backend>" (e.g.
        // "b4589/linux-cuda-12"). Any other shape silently skips verification.
        const [version, backend] = effectiveBackendString.split('/')
        if (version && backend) {
          await this.verifyBackendDeps(backend, version)
        }
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
    if (this.isUpdatingBackend) {
      logger.warn('Backend update already in progress, skipping new update request')
      // Treat concurrent update requests as a benign no-op and report that no new update
      // was performed, while still returning the current backend value.
      return { wasUpdated: false, newBackend: this.config.version_backend }
    }

    this.isUpdatingBackend = true

    try {
      if (!targetBackendString)
        throw new Error(
          `Invalid backend string: ${targetBackendString} supplied to update function`
        )

      const backendParts = targetBackendString.split('/')

      if (
        backendParts.length !== 2 ||
        !backendParts[0]?.trim() ||
        !backendParts[1]?.trim()
      ) {
        throw new Error(
          `Invalid backend string format: "${targetBackendString}". Expected "version/backend".`
        )
      }

      const [rawVersion, rawBackend] = backendParts
      const version = rawVersion.trim()
      const backend = rawBackend.trim()

      // Normalize the target backend string to use trimmed values
      targetBackendString = `${version}/${backend}`

      logger.info(
        `Updating backend to ${targetBackendString} (backend type: ${backend})`
      )

      // Download new backend using the original asset/backend name
      await this.ensureBackendReady(backend, version)

      // Add delay on Windows
      if (IS_WINDOWS) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // Map backend type for stored preference only (not for download/config)
      const effectiveBackendType = await mapOldBackendToNew(backend)
      const currentStoredBackend = this.getStoredBackendType()

      // Persist settings and stored preference before mutating in-memory config,
      // so that if any of these steps fail, config remains consistent.

      // Update settings first — if this fails, we haven't mutated any state yet
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (item.key === 'version_backend') {
            item.controllerProps.value = targetBackendString
          }
          return item
        })
      )

      // Store the backend type preference only if it changed
      if (currentStoredBackend !== effectiveBackendType) {
        this.setStoredBackendType(effectiveBackendType)
        logger.info(
          `Updated stored backend type preference: ${effectiveBackendType}`
        )
      }

      // All critical side effects succeeded — now commit to in-memory config
      this.config.version_backend = targetBackendString
      this.config.device = ''

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

      // Clean up old versions — best-effort, don't fail the update if this errors
      try {
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
      } catch (cleanupError) {
        logger.warn('Failed to remove old backend versions:', cleanupError)
      }

      return { wasUpdated: true, newBackend: targetBackendString }
    } catch (error) {
      logger.error('Backend update failed:', error)
      return { wasUpdated: false, newBackend: this.config.version_backend }
    } finally {
      this.isUpdatingBackend = false
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

    try {
      await invoke('plugin:llamacpp|stop_router')
    } catch (e) {
      logger.warn('stop_router during onUnload failed (ignored):', e)
    }
    this.routerPort = undefined
    this.routerApiKey = undefined
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === 'version_backend') {
      // Skip entirely if updateBackend() is already handling it —
      // updateBackend() will commit to in-memory config itself after all
      // side effects succeed.
      if (this.isUpdatingBackend) {
        return
      }
    }

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
            try {
              await this.startRouter()
            } catch (e) {
              logger.warn('Router restart after backend update failed:', e)
            }
          }
        } catch (e) {
          logger.error('Error in onSettingUpdate async block:', e)
        }
      })()
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
    const cfg = modelConfig as ModelConfig & { embedding_check_v?: number }
    const hasFlag = typeof cfg.embedding === 'boolean'
    const upToDate = cfg.embedding_check_v === EMBEDDING_CHECK_VERSION
    if (hasFlag && upToDate) {
      return cfg.embedding as boolean
    }
    if (hasFlag && cfg.embedding === true) {
      return true
    }

    let isEmbedding = false
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const fullModelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])

      if (await fs.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath)
        if (detectEmbeddingFromGgufMeta(metadata.metadata)) {
          isEmbedding = true
        }
      }
    } catch (e) {
      logger.warn(`Failed to check metadata for ${modelId}`, e)
      return cfg.embedding === true
    }

    try {
      const configPath = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
        'model.yml',
      ])

      cfg.embedding = isEmbedding
      cfg.embedding_check_v = EMBEDDING_CHECK_VERSION
      if (isEmbedding) {
        const c = cfg as ModelConfig & {
          pooling?: string
          ubatch_size?: number
          batch_size?: number
        }
        if (!c.pooling) c.pooling = 'mean'
        if (!c.ubatch_size) c.ubatch_size = 2048
        if (!c.batch_size) c.batch_size = 2048
      }

      await invoke<void>('write_yaml', {
        data: cfg,
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
        const caps = await this.readMmprojCapabilities(
          modelConfig.mmproj_path
        )
        if (caps.vision) capabilities.push('vision')
        if (caps.audio) capabilities.push('audio')
      }

      const mp = modelConfig.model_path ?? ''
      const isAbsolute = mp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(mp)

      const modelInfo = {
        id: modelId,
        name: modelConfig.name ?? modelId,
        quant_type: undefined, // TODO: parse quantization type from model.yml or model.gguf
        providerId: this.provider,
        port: 0, // port is not known until the model is loaded
        sizeBytes: modelConfig.size_bytes ?? 0,
        embedding: isEmbedding,
        imported: isAbsolute,
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

      if (detectEmbeddingFromGgufMeta(modelMetadata.metadata)) {
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
      embedding_check_v: EMBEDDING_CHECK_VERSION,
      ...(isEmbedding
        ? { pooling: 'mean', ubatch_size: 2048, batch_size: 2048 }
        : {}),
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

    if (downloadItems.length > 0) {
      events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
        modelId,
        downloadType: 'Model',
      })
    }

    try {
      await this.startRouter()
    } catch (e) {
      logger.warn(`Router refresh after import(${modelId}) failed:`, e)
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

  private async getRandomPort(): Promise<number> {
    return 49152 + Math.floor(Math.random() * (65535 - 49152))
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
    _overrideSettings?: Partial<LlamacppConfig>,
    isEmbedding: boolean = false,
    _bypassAutoUnload: boolean = false
  ): Promise<SessionInfo> {
    const sInfo = await this.findSessionByModel(modelId)
    if (sInfo) {
      throw new Error('Model already loaded!!')
    }

    if (this.loadingModels.has(modelId)) {
      return this.loadingModels.get(modelId)!
    }

    const loadingPromise = this.performLoad(modelId, isEmbedding)
    this.loadingModels.set(modelId, loadingPromise)

    try {
      return await loadingPromise
    } finally {
      this.loadingModels.delete(modelId)
    }
  }

  private async performLoad(
    modelId: string,
    isEmbedding: boolean = false
  ): Promise<SessionInfo> {
    const router = await this.getRouterInfo()
    if (!router) {
      throw new Error(
        'llama.cpp router is not running. Please restart the app.'
      )
    }

    if (!isEmbedding) {
      await this.evictChatIfAtCapacity(modelId)
    }

    try {
      const info = await loadLlamaModel(modelId, isEmbedding)
      if (!isEmbedding) {
        this.loadedChatOrder = this.loadedChatOrder.filter((m) => m !== modelId)
        this.loadedChatOrder.push(modelId)
      }
      return info
    } catch (error) {
      logger.error('Error in load command:\n', error)
      throw error
    }
  }

  /**
   * Enforce `userModelsMax` against chat models only. Reconciles the local
   * FIFO against the router's loaded set, then unloads the oldest chat model
   * if loading `incomingModelId` would exceed the user-configured cap.
   */
  private async evictChatIfAtCapacity(incomingModelId: string): Promise<void> {
    if (this.userModelsMax <= 0) return // unlimited

    let loaded: string[] = []
    try {
      loaded = await this.getLoadedModels()
    } catch {
      // If we can't introspect, fall back to the local FIFO — better to
      // over-evict than to violate the cap.
      loaded = [...this.loadedChatOrder]
    }
    const loadedSet = new Set(loaded)
    this.loadedChatOrder = this.loadedChatOrder.filter(
      (m) => loadedSet.has(m) && m !== incomingModelId
    )

    while (this.loadedChatOrder.length >= this.userModelsMax) {
      const victim = this.loadedChatOrder.shift()
      if (!victim) break
      try {
        const result = await unloadLlamaModel(victim)
        if (!result.success) {
          logger.warn(
            `Pre-eviction of ${victim} reported failure: ${result.error}`
          )
        } else {
          logger.info(
            `Pre-evicted chat model ${victim} to make room for ${incomingModelId}`
          )
        }
      } catch (e) {
        logger.warn(`Pre-eviction of ${victim} threw:`, e)
      }
    }
  }

  override async unload(modelId: string): Promise<UnloadResult> {
    const sInfo = await this.findSessionByModel(modelId)
    if (!sInfo) {
      throw new Error(`No active session found for model: ${modelId}`)
    }
    try {
      const result = await unloadLlamaModel(modelId)
      if (result.success) {
        this.loadedChatOrder = this.loadedChatOrder.filter((m) => m !== modelId)
        logger.info(`Successfully unloaded model ${modelId}`)
      } else {
        logger.warn(`Failed to unload model ${modelId}: ${result.error}`)
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

  private async verifyBackendDeps(backend: string, version: string): Promise<void> {
    const backendKey = `${version}/${backend}`
    try {
      const verification = await verifyBackendInstallation(backend, version)
      if (verification.verified) {
        logger.info(
          `Backend ${backendKey} dependency verification passed (${verification.resolved_libraries.length} libraries resolved)`
        )
      } else {
        logger.warn(
          `Backend ${backendKey} is missing libraries: ${verification.missing_libraries.join(', ')}`
        )
        events.emit(AppEvent.onBackendVerificationFailed, {
          backend,
          version,
          missingLibraries: verification.missing_libraries,
        })
      }
    } catch (verifyErr) {
      // Intentionally non-fatal: verification is advisory only. A BinaryNotFound
      // error here means the exe disappeared between install and startup — the
      // backend will fail naturally when first used, which is surfaced elsewhere.
      logger.warn(`Backend ${backendKey} dependency verification failed: ${verifyErr}`)
    }
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
    // AbortSignal.any() is not available in all runtimes (e.g. WebKit/JavaScriptCore),
    // so we manually combine the timeout and external abort signals.
    const combinedController = new AbortController()
    const timeoutId = setTimeout(
      () => combinedController.abort(new Error('Request timed out')),
      this.timeout * 1000
    )
    if (abortController?.signal) {
      if (abortController.signal.aborted) {
        combinedController.abort(abortController.signal.reason)
      } else {
        abortController.signal.addEventListener(
          'abort',
          () => combinedController.abort(abortController.signal.reason),
          { once: true }
        )
      }
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      connectTimeout: Number(this.timeout) * 1000, // default 10 minutes
      signal: combinedController.signal,
    }).finally(() => clearTimeout(timeoutId))
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

  private async findSessionByModel(
    modelId: string
  ): Promise<SessionInfo | null> {
    try {
      return await invoke<SessionInfo | null>(
        'plugin:llamacpp|find_session_by_model',
        { modelId }
      )
    } catch (e) {
      logger.error(e)
      throw new Error(String(e))
    }
  }

  private async ensureHealthySession(modelId: string): Promise<SessionInfo> {
    return invoke<SessionInfo>('plugin:llamacpp|ensure_session_ready', {
      modelId,
      isEmbedding: false,
    })
  }

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const sessionInfo = await this.ensureHealthySession(opts.model)
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

    try {
      await this.startRouter()
    } catch (e) {
      logger.warn(`Router refresh after delete(${modelId}) failed:`, e)
    }
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
    const downloadedModelList = await this.list()
    const installedEmbedding = downloadedModelList.filter(
      (m) => (m as any).embedding === true
    )
    const hasMini = downloadedModelList.some(
      (m) => m.id === 'sentence-transformer-mini'
    )
    let preferred = getDefaultEmbeddingModelId('llamacpp')

    if (!preferred && installedEmbedding.length === 1 && !hasMini) {
      preferred = installedEmbedding[0].id
      setDefaultEmbeddingModelId('llamacpp', preferred)
      logger.info(
        `Auto-promoted "${preferred}" as default embedding model (single installed model, sentence-transformer-mini not present)`
      )
    }

    const preferredMatch =
      preferred && installedEmbedding.find((m) => m.id === preferred)

    if (preferred && !preferredMatch) {
      logger.warn(
        `Default embedding model "${preferred}" not installed; falling back to sentence-transformer-mini`
      )
    }

    const targetModelId = preferredMatch
      ? (preferred as string)
      : 'sentence-transformer-mini'

    let sInfo = await this.findSessionByModel(targetModelId)
    if (!sInfo) {
      if (targetModelId === 'sentence-transformer-mini' && !hasMini) {
        await this.import('sentence-transformer-mini', {
          modelPath:
            'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf?download=true',
        })
      }
      sInfo = await this.load(targetModelId, undefined, true)
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
      const response = await attemptRequest(sInfo as SessionInfo, batchInput)
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(
          `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
        )
      }
      return (await response.json()) as EmbedBatchResult
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

  async getHubModelScore(
    request: HubModelScoreRequest
  ): Promise<HubModelScoreResult> {
    try {
      return await scoreHubModel(request)
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
    let imageTokens = 0
    const hasImages = opts.messages.some(
      (msg) =>
        Array.isArray(msg.content) &&
        msg.content.some((content) => content.type === 'image_url')
    )

    if (hasImages) {
      try {
        const janDataFolderPath = await getJanDataFolderPath()
        const modelConfigPath = await joinPath([
          this.providerPath,
          'models',
          opts.model,
          'model.yml',
        ])
        const modelConfig = await invoke<ModelConfig>('read_yaml', {
          path: modelConfigPath,
        })
        if (modelConfig.mmproj_path) {
          const mmprojPath = await joinPath([
            janDataFolderPath,
            modelConfig.mmproj_path,
          ])
          const metadata = await readGgufMetadata(mmprojPath)
          imageTokens = await this.calculateImageTokens(
            opts.messages,
            metadata.metadata
          )
        }
      } catch (error) {
        logger.warn('Failed to calculate image tokens:', error)
        imageTokens = this.estimateImageTokensFallback(opts.messages)
      }
    }

    let textChars = 0
    for (const msg of opts.messages) {
      if (typeof msg.content === 'string') {
        textChars += msg.content.length
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && typeof part.text === 'string') {
            textChars += part.text.length
          }
        }
      }
    }
    const textTokens = Math.ceil(textChars / 4)
    return textTokens + imageTokens
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
