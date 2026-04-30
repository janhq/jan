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
  computeNextCtxLen,
  ModelEvent,
} from '@janhq/core'

import { error, info, warn } from '@tauri-apps/plugin-log'
import { listen, emit as tauriEmit } from '@tauri-apps/api/event'
import {
  listSupportedBackends,
  isBackendInstalled,
  getBackendExePath,
  getBackendDir,
  getLocalInstalledBackends,
  getBackendDownloadUrl,
} from './backend'
import { invoke, Channel } from '@tauri-apps/api/core'
import {
  getProxyConfig,
  buildEmbedBatches,
  mergeEmbedResponses,
  type EmbedBatchResult,
} from './util'
import { basename } from '@tauri-apps/api/path'
import { getSystemUsage, getSystemInfo } from './hardware'
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
  removeOldBackendVersions,
  shouldMigrateBackend,
  handleSettingUpdate,
  installBundledBackend,
  checkBackendForUpdates as checkBackendForUpdatesFromRust,
  getSupportedFeaturesFromRust,
  normalizeFeatures,
} from '../../../src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index'

// Error message constant - matches web-app/src/utils/error.ts
const OUT_OF_CONTEXT_SIZE = 'the request exceeds the available context size.'

/// Payload emitted by the Rust proxy when it detects a context-limit error
/// that we (the TS side) should recover from by reloading the backend with
/// a larger ctx window.
interface AutoIncreaseCtxRequest {
  request_id: string
  backend: 'llamacpp' | 'mlx'
  model_id: string
  trigger: 'error' | 'finish_length'
}

/// Tauri channel constants used by the Rust proxy (`proxy.rs`) to coordinate
/// a context-window grow with the owning backend extension.
const AUTO_INCREASE_CTX_EVENT = 'local_backend://auto_increase_ctx'
const AUTO_INCREASE_CTX_DONE_PREFIX = 'local_backend://auto_increase_ctx_done/'
/// Broadcast channel that mirrors `ModelEvent.OnAutoIncreasedCtxLen` but
/// goes through the native Tauri event bus instead of the `@janhq/core`
/// in-process EventEmitter. Having a parallel Tauri-level signal avoids
/// losing UI-sync when the web-app happens to bundle a different `events`
/// singleton than the extension does.
const AUTO_INCREASE_CTX_NOTIFY = 'local_backend://auto_increase_ctx_notify'

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

function stripBom(s: string): string {
  return s.replace(/\uFEFF/g, '').trim()
}

function backendCategoryToLabel(category: string): string {
  switch (category) {
    case 'cuda-cu13.0': return 'CUDA 13'
    case 'cuda-cu12.0': return 'CUDA 12'
    case 'cuda-cu11.7': return 'CUDA 11'
    case 'vulkan': return 'Vulkan'
    default: return category
  }
}

function get_backend_category(backend: string): string {
  if (backend.includes('cuda-13-common_cpus')) return 'cuda-cu13.0'
  if (backend.includes('cuda-12-common_cpus') || backend.includes('cu12.0'))
    return 'cuda-cu12.0'
  if (backend.includes('cuda-11-common_cpus') || backend.includes('cu11.7'))
    return 'cuda-cu11.7'
  if (backend.includes('vulkan')) return 'vulkan'
  if (backend.includes('common_cpus')) return 'common_cpus'
  if (backend.includes('avx512')) return 'avx512'
  if (backend.includes('avx2')) return 'avx2'
  if (
    backend.includes('avx') &&
    !backend.includes('avx2') &&
    !backend.includes('avx512')
  )
    return 'avx'
  if (backend.includes('noavx')) return 'noavx'
  return 'unknown'
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
  autoUnload: boolean = false
  timeout: number = 600
  llamacpp_env: string = ''
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private providerPath!: string
  private apiSecret: string = 'JustAskNow'
  private isConfiguringBackends: boolean = false
  private isUpdatingBackend: boolean = false
  private isInitializing: boolean = true
  private configureBackendsPromise: Promise<void> | null = null
  private loadingModels = new Map<string, Promise<SessionInfo>>() // Track loading promises
  private sessionCache = new Map<string, SessionInfo>()
  /// Tracks the ctx_size a model was last loaded with so the Local API
  /// Server auto-increase flow knows the "current" value — the extension's
  /// `this.config.ctx_size` is only a default and doesn't reflect UI-level
  /// per-model overrides.
  private modelCtxSize = new Map<string, number>()
  private unlistenValidationStarted?: () => void
  private unlistenAutoIncreaseCtx?: () => void

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    let settings = structuredClone(SETTINGS) // Clone to modify settings definition before registration

    // Preserve persisted `version_backend` across sessions on Windows/Linux.
    //
    // `registerSettings()` (in core extension.ts) keeps the persisted value
    // ONLY if the new `options` list contains it; otherwise it silently
    // resets value to `options[0]`. On every cold start the persisted
    // `options` may be a stale subset (e.g. `[bundled]`) that no longer
    // contains the previously selected GPU backend (e.g. CUDA), in which
    // case the persisted value is wiped to bundled — silently undoing the
    // user's last hot-swap.
    //
    // Solution: before calling `registerSettings(SETTINGS)` (which arrives
    // with empty options), inject the persisted value into the new options
    // list so the deduplication check passes and the value survives.
    //
    // Limited to non-macOS to keep turboquant/MLX flow on macOS untouched
    // (per design decision).
    if (!IS_MAC) {
      try {
        const persistedSettings = await this.getSettings()
        const persistedVbRaw = persistedSettings.find(
          (s) => s.key === 'version_backend'
        )?.controllerProps?.value
        const persistedVb =
          typeof persistedVbRaw === 'string' ? stripBom(persistedVbRaw) : ''
        if (
          persistedVb &&
          persistedVb !== 'none' &&
          persistedVb.includes('/')
        ) {
          const vbSetting = settings.find((s) => s.key === 'version_backend')
          if (vbSetting && 'options' in vbSetting.controllerProps) {
            vbSetting.controllerProps.options = [
              { value: persistedVb, name: persistedVb },
            ]
            vbSetting.controllerProps.value = persistedVb
            logger.info(
              `[onLoad] Preserving persisted version_backend across registerSettings: ${persistedVb}`
            )
          }
        }
      } catch (err) {
        logger.warn(
          '[onLoad] Failed to read persisted settings for version_backend preservation:',
          err
        )
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

    // Strip any BOM characters persisted from earlier PowerShell-generated files
    if (this.config.version_backend) {
      const cleaned = stripBom(this.config.version_backend)
      if (cleaned !== this.config.version_backend) {
        this.config.version_backend = cleaned
        const allSettings = await this.getSettings()
        await this.updateSettings(
          allSettings.map((item) => {
            if (item.key === 'version_backend') {
              item.controllerProps.value = cleaned
            }
            return item
          })
        )
        logger.info(`Cleaned BOM from version_backend: "${cleaned}"`)
      }
    }

    // Migration v1: upgrade f16 KV cache defaults to q8_0
    await this.migrateKvCacheDefaults()

    // Migration v2: upgrade KV cache defaults to turbo3 (turboquant)
    await this.migrateKvCacheToTurbo3()

    // Migration v3: disable fit by default
    await this.migrateFitDefault()

    this.timeout = this.config.timeout
    this.llamacpp_env = this.config.llamacpp_env
    this.autoUnload = this.config.auto_unload ?? true

    // This sets the base directory where model files for this provider are stored.
    this.getProviderPath()

    // Activate a pending backend that was downloaded before the last restart.
    await this.activatePendingBackend()

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

    // Local API Server auto-increase-ctx bridge. The Rust proxy fires this
    // event whenever a forwarded request hits a context-limit error; we
    // reply on a request-scoped channel so the proxy can retry transparently
    // (see `proxy.rs::maybe_auto_increase_and_retry`).
    this.unlistenAutoIncreaseCtx = await listen<AutoIncreaseCtxRequest>(
      AUTO_INCREASE_CTX_EVENT,
      (event) => {
        if (event.payload?.backend !== 'llamacpp') return
        void this.handleAutoIncreaseCtx(event.payload)
      }
    )

    //* configureBackends может долго качать движок — не await, иначе весь UI ждёт завершения.
    this.configureBackendsPromise = this.configureBackends()
      .catch((err) => {
        //! Раньше отклонённый промис терялся; без лога сложно понять вечный «loading» в настройках.
        logger.error('configureBackends failed:', err)
      })
      .finally(() => {
        this.isInitializing = false
        this.configureBackendsPromise = null
      })
  }

  private getStoredBackendType(): string | null {
    try {
      const val = localStorage.getItem('llama_cpp_backend_type')
      return val ? stripBom(val) : null
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
    const needsMigration = keysToMigrate.some((k) => this.config[k] === 'f16')

    if (needsMigration) {
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (
            keysToMigrate.includes(
              item.key as (typeof keysToMigrate)[number]
            ) &&
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

  private async migrateKvCacheToTurbo3(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_kv_cache_migrated_turbo3_v2'
    if (localStorage.getItem(MIGRATION_KEY)) return

    const keysToMigrate = ['cache_type_k', 'cache_type_v'] as const
    const needsMigration = keysToMigrate.some(
      (k) => this.config[k] !== 'turbo3'
    )

    if (needsMigration) {
      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (
            keysToMigrate.includes(
              item.key as (typeof keysToMigrate)[number]
            ) &&
            item.controllerProps.value !== 'turbo3'
          ) {
            item.controllerProps.value = 'turbo3'
          }
          return item
        })
      )
      for (const k of keysToMigrate) {
        if (this.config[k] !== 'turbo3') this.config[k] = 'turbo3'
      }
      logger.info('Migrated KV cache types to turbo3')
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

  private async activatePendingBackend(): Promise<void> {
    const pending = localStorage.getItem('llama_cpp_pending_backend')
    if (!pending) return

    const cleaned = stripBom(pending)
    const parts = cleaned.split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      logger.warn(`Invalid pending backend string "${cleaned}", clearing`)
      localStorage.removeItem('llama_cpp_pending_backend')
      return
    }

    const [version, backend] = [parts[0].trim(), parts[1].trim()]

    try {
      const installed = await isBackendInstalled(backend, version)
      if (!installed) {
        logger.warn(
          `Pending backend ${cleaned} not found on disk, clearing`
        )
        localStorage.removeItem('llama_cpp_pending_backend')
        return
      }

      logger.info(
        `Activating pending backend from previous download: ${cleaned}`
      )
      const result = await this.updateBackend(cleaned)
      if (result.wasUpdated) {
        logger.info(`Pending backend ${cleaned} activated successfully`)
      } else {
        logger.warn(`Failed to activate pending backend ${cleaned}`)
      }
    } catch (err) {
      logger.error('Error activating pending backend:', err)
    } finally {
      localStorage.removeItem('llama_cpp_pending_backend')
    }
  }

  private async tryInstallBundledBackend(): Promise<string | null> {
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const backendsDir = await joinPath([
        janDataFolderPath,
        'llamacpp',
        'backends',
      ])

      const result = await installBundledBackend(backendsDir)

      if (result.installed && result.backend_string) {
        logger.info(`Bundled backend installed: ${result.backend_string}`)
        return result.backend_string
      } else {
        logger.info('No bundled backend available or already installed')
        return null
      }
    } catch (e) {
      logger.warn('Failed to install bundled backend:', e)
      return null
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
      // Sanitize any BOM characters left over from previous sessions
      if (this.config.version_backend) {
        this.config.version_backend = stripBom(this.config.version_backend)
      }

      // Install bundled backend from app resources if no local backends exist
      const bundledBackendString = await this.tryInstallBundledBackend()

      // Immediately apply a backend so the model can load without
      // waiting for the remote backend list (GitHub API can be slow/down).
      //
      // If the persisted UI settings (localStorage `@janhq/llamacpp-extension`)
      // were lost between launches — e.g. the user wiped WebView2 storage via
      // `make dev-windows-cpu`, ran a factoryReset, or the WebView2 cache got
      // corrupted — `this.config.version_backend` arrives empty even though a
      // GPU backend may still be physically installed in the data folder.
      // Without recovery the next branch would silently re-pin bundled CPU and
      // the user would lose their previously selected backend on every restart.
      //
      // Recovery: scan installed backends on disk and pick the best one. This
      // is intentionally limited to non-macOS to keep the existing
      // turboquant/MLX flow on macOS untouched (per design decision).
      const currentVB = this.config.version_backend || ''
      const persistedMissing =
        !currentVB || currentVB === 'none' || !currentVB.includes('/')

      if (persistedMissing && !IS_MAC) {
        try {
          const localInstalled = await getLocalInstalledBackends()
          if (localInstalled.length > 0) {
            const recovered = await this.determineBestBackend(localInstalled)
            if (recovered && recovered.includes('/')) {
              this.config.version_backend = recovered
              const recoveredType = recovered.split('/')[1]
              if (recoveredType) {
                this.setStoredBackendType(recoveredType)
              }
              logger.info(
                `[configureBackends] Recovered version_backend from disk: ${recovered} (localStorage was empty)`
              )
            }
          }
        } catch (err) {
          logger.warn(
            'Failed to recover backends from disk; will fall back to bundled:',
            err
          )
        }
      }

      if (bundledBackendString) {
        const vbAfterRecovery = this.config.version_backend || ''
        if (
          !vbAfterRecovery ||
          vbAfterRecovery === 'none' ||
          !vbAfterRecovery.includes('/')
        ) {
          this.config.version_backend = bundledBackendString
          logger.info(
            `Applied bundled backend immediately: ${bundledBackendString}`
          )
        }
      }

      // GPU-backend detection deliberately does NOT run here anymore.
      //
      // Previously this method ran `detectIdealBackendType()` on every
      // app launch (and again after the remote release fetch), which
      // showed up in the logs as a periodic "we're trying to install a
      // better backend" pass — even though no install ever happened
      // unless the user clicked through the dialog. The user found
      // this opaque and asked for it to be turned off entirely.
      //
      // Detection now happens only at the two explicit user-facing
      // entry points, both of which call `recheckOptimalBackend()`:
      //   1. `SetupBackendStep` on first-launch onboarding.
      //   2. The manual "Find optimal backend" button in provider
      //      settings.
      //
      // `configureBackends()` keeps its other responsibilities:
      // bundled-backend extraction, settings registration, and
      // version auto-upgrade for the same backend family.

      // --- Early settings registration with bundled backend ---
      // Register settings with at least the bundled backend so the UI
      // isn't stuck in "loading" while the GitHub API responds.
      if (bundledBackendString) {
        const earlySettings = structuredClone(SETTINGS)
        const earlyBackendIdx = earlySettings.findIndex(
          (item) => item.key === 'version_backend'
        )
        if (earlyBackendIdx !== -1) {
          const earlySetting = earlySettings[earlyBackendIdx]
          const currentVB = this.config.version_backend || ''
          const earlyOptions = [
            { value: bundledBackendString, name: bundledBackendString },
          ]
          if (currentVB && currentVB !== bundledBackendString) {
            earlyOptions.unshift({ value: currentVB, name: currentVB })
          }
          earlySetting.controllerProps.options = earlyOptions
          earlySetting.controllerProps.value = currentVB || bundledBackendString
        }
        this.registerSettings(earlySettings)
        logger.info('[configureBackends] Early settings registered with bundled backend')
      }

      let version_backends: {
        version: string
        backend: string
        order?: number
      }[] = []

      try {
        logger.info('[configureBackends] Fetching supported backends...')
        version_backends = await listSupportedBackends()
        logger.info(
          `[configureBackends] Got ${version_backends.length} backends: ${version_backends.map((b) => `${b.version}/${b.backend}`).join(', ')}`
        )
        if (version_backends.length === 0) {
          throw new Error(
            'No supported backend binaries found for this system. Backend selection and auto-update will be unavailable.'
          )
        } else {
          version_backends.sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
        }
      } catch (error) {
        if (bundledBackendString) {
          logger.warn(
            `Failed to fetch supported backends (${
              error instanceof Error ? error.message : error
            }), continuing with bundled backend: ${bundledBackendString}`
          )
          const [bVer, bBack] = bundledBackendString.split('/')
          if (bVer && bBack) {
            version_backends = [{ version: bVer, backend: bBack, order: 0 }]
          }
        } else {
          throw new Error(
            `Failed to fetch supported backends: ${
              error instanceof Error ? error.message : error
            }`
          )
        }
      }

      // Get stored backend preference
      const storedBackendType = this.getStoredBackendType()
      let bestAvailableBackendString = ''

      // Calculate the "best" backend first, as it's used for fallback and defaults
      bestAvailableBackendString =
        await this.determineBestBackend(version_backends)
      logger.info(
        `[configureBackends] Best backend: ${bestAvailableBackendString}, storedType: ${storedBackendType || '(none)'}`
      )

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
        } else if (IS_MAC) {
          // macOS turboquant flow expects stale storedType to be cleared so
          // the bundled backend can take over via the force-switch block.
          logger.warn(
            `Stored backend type '${effectiveStoredBackendType}' not available, falling back to best backend`
          )
          this.clearStoredBackendType()
        } else {
          // Windows/Linux: GitHub may be temporarily unreachable / rate-
          // limited, so the user's preference may simply not be visible in
          // version_backends right now. Keep the stored preference; the
          // installed-on-disk guards below ensure we don't downgrade to
          // bundled CPU when the saved backend is still on the filesystem.
          logger.warn(
            `Stored backend type '${effectiveStoredBackendType}' not in remote/local list right now; keeping preference (network may be unstable)`
          )
        }
      }

      // Compute once whether the currently-saved version_backend is actually
      // present on disk. Used below to:
      //   - keep the saved option visible in the dropdown even when the
      //     remote backend list (`version_backends`) doesn't include it,
      //   - skip the auto-upgrade swap if the "newer" target isn't
      //     downloaded yet,
      //   - skip the fresh-installation fallback when the saved backend is
      //     still installed locally (e.g. GitHub temporarily unavailable).
      const savedVB = stripBom(this.config.version_backend || '')
      const [savedVbVer, savedVbBack] = savedVB.split('/')
      const savedVbIsInstalled =
        !!savedVbVer?.trim() &&
        !!savedVbBack?.trim() &&
        savedVB.includes('/') &&
        (await isBackendInstalled(savedVbBack.trim(), savedVbVer.trim()))

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

        // Always surface the installed-on-disk saved backend in the dropdown,
        // even when the remote list (e.g. GitHub) didn't return it. Without
        // this the user sees an empty/incomplete options list after a
        // restart with no network.
        if (
          savedVbIsInstalled &&
          !(
            backendSetting.controllerProps.options as Array<{
              value: string
              name: string
            }>
          ).some((o) => o.value === savedVB)
        ) {
          backendSetting.controllerProps.options = [
            { value: savedVB, name: savedVB },
            ...(backendSetting.controllerProps.options as Array<{
              value: string
              name: string
            }>),
          ]
          logger.info(
            `Saved backend ${savedVB} not present in version_backends list — pinning it into options (installed locally)`
          )
        }

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
            const normalizedBackend = await mapOldBackendToNew(savedBackend)

            // Always prefer the latest downloaded version for the saved backend type
            const latestForType = await findLatestVersionForBackend(
              version_backends,
              normalizedBackend
            )
            initialUiDefault =
              latestForType || `${savedVersion}/${normalizedBackend}`

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

      let effectiveBackendString = stripBom(this.config.version_backend || '')

      // Auto-upgrade to the latest downloaded version of the same backend type
      if (
        effectiveBackendString &&
        bestAvailableBackendString &&
        effectiveBackendString !== bestAvailableBackendString &&
        effectiveBackendString.includes('/')
      ) {
        const currentType = effectiveBackendString.split('/')[1]?.trim()
        const bestType = bestAvailableBackendString.split('/')[1]?.trim()
        if (currentType && bestType && currentType === bestType) {
          // Only swap when the "newer" target is actually downloaded.
          // Otherwise we'd end up with config pointing at a backend that
          // isn't on disk yet — e.g. after an app update where the bundled
          // CPU got bumped, but the user's CUDA backend hasn't been
          // re-downloaded for the new release tag.
          const [bestVer, bestBack] = bestAvailableBackendString.split('/')
          const bestIsInstalled =
            !!bestVer?.trim() &&
            !!bestBack?.trim() &&
            (await isBackendInstalled(bestBack.trim(), bestVer.trim()))

          if (!bestIsInstalled) {
            logger.info(
              `Skipping auto-upgrade ${effectiveBackendString} → ${bestAvailableBackendString}: target not installed locally`
            )
          } else {
            logger.info(
              `Auto-upgrading backend to latest version: ${effectiveBackendString} → ${bestAvailableBackendString}`
            )
            effectiveBackendString = bestAvailableBackendString

            this.config.version_backend = effectiveBackendString

            const updatedSettings = await this.getSettings()
            await this.updateSettings(
              updatedSettings.map((item) => {
                if (item.key === 'version_backend') {
                  item.controllerProps.value = effectiveBackendString
                }
                return item
              })
            )

            if (events && typeof events.emit === 'function') {
              events.emit('settingsChanged', {
                key: 'version_backend',
                value: effectiveBackendString,
              })
            }
          }
        }
      }

      // Force-switch to the bundled backend in certain scenarios:
      //
      // macOS (turboquant pipeline):
      //   1. Current backend is not turboquant → migrate to bundled turboquant
      //   2. Bundled is a newer version of the same backend type → app update
      //
      // Windows/Linux (janhq/llama.cpp pipeline):
      //   Only force-switch when the bundled backend is a newer version of the
      //   SAME type (e.g. CPU→CPU on app update). Never override a user's
      //   auto-downloaded GPU backend (e.g. CUDA) with the bundled CPU backend.
      if (
        bundledBackendString &&
        effectiveBackendString &&
        effectiveBackendString.includes('/')
      ) {
        const bundledType = bundledBackendString.split('/')[1]
        const currentType = effectiveBackendString.split('/')[1]
        const isBundledNewer =
          effectiveBackendString !== bundledBackendString &&
          bundledType === currentType

        const shouldForceSwitch = IS_MAC
          ? !effectiveBackendString.startsWith('turboquant-') || isBundledNewer
          : isBundledNewer

        if (shouldForceSwitch) {
          logger.info(
            `Switching backend from '${effectiveBackendString}' to bundled '${bundledBackendString}'` +
              (isBundledNewer ? ' (app update)' : ' (turboquant migration)')
          )
          effectiveBackendString = bundledBackendString
          bestAvailableBackendString = bundledBackendString
        }
      }

      // Handle fresh installation case where version_backend might be 'none' or invalid.
      //
      // The previous condition also reset to bundled whenever the saved
      // backend was missing from `version_backends` — but that list comes
      // partly from a remote GitHub fetch which can fail or return a
      // truncated set, leading to a CUDA→CPU regression on every restart.
      // Guard the fallback with `savedVbIsInstalled`: only force-fallback
      // when the saved backend is genuinely gone from disk.
      const savedNotInList =
        !!effectiveBackendString &&
        effectiveBackendString.includes('/') &&
        !version_backends.some(
          (e) => `${e.version}/${e.backend}` === effectiveBackendString
        )
      const savedBackendVanished =
        !effectiveBackendString ||
        effectiveBackendString === 'none' ||
        !effectiveBackendString.includes('/') ||
        (savedNotInList && !savedVbIsInstalled)

      if (savedBackendVanished && bestAvailableBackendString) {
        effectiveBackendString = bestAvailableBackendString
        logger.info(
          `Fresh installation or invalid backend detected, using: ${effectiveBackendString}`
        )

        this.config.version_backend = effectiveBackendString

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

        if (events && typeof events.emit === 'function') {
          events.emit('settingsChanged', {
            key: 'version_backend',
            value: effectiveBackendString,
          })
        }
      } else if (savedNotInList && savedVbIsInstalled) {
        logger.warn(
          `Saved backend ${effectiveBackendString} not in remote list but installed locally — keeping it active`
        )
      }

      // Late-phase GPU-backend detection has also been removed —
      // see the comment near the top of this function. Any
      // recommendation now flows through `recheckOptimalBackend()`,
      // which is invoked only by user-driven UI surfaces.
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

  /**
   * Uses hardware detection (CUDA/Vulkan driver info) to determine the ideal
   * backend type for this machine. Returns the backend name string
   * (e.g. "win-cuda-13-common_cpus-x64") or null if CPU is already optimal.
   */
  private async detectIdealBackendType(): Promise<string | null> {
    try {
      const sysInfo = await getSystemInfo()
      const rawFeatures = await getSupportedFeaturesFromRust(
        sysInfo.os_type,
        sysInfo.cpu.extensions,
        sysInfo.gpus
      )
      const features = normalizeFeatures(rawFeatures)

      let hasEnoughVram = false
      for (const gpuInfo of sysInfo.gpus) {
        if (gpuInfo.total_memory >= 6 * 1024) {
          hasEnoughVram = true
          break
        }
      }

      const arch = sysInfo.cpu.arch
      const archSuffix =
        arch.includes('aarch64') || arch.includes('arm64') ? 'arm64' : 'x64'
      const prefix = sysInfo.os_type === 'windows' ? 'win' : 'linux'

      if (features.cuda13) return `${prefix}-cuda-13-common_cpus-${archSuffix}`
      if (features.cuda12) return `${prefix}-cuda-12-common_cpus-${archSuffix}`
      if (features.cuda11) return `${prefix}-cuda-11-common_cpus-${archSuffix}`
      if (features.vulkan && hasEnoughVram)
        return `${prefix}-vulkan-common_cpus-${archSuffix}`

      return null
    } catch (err) {
      logger.warn('detectIdealBackendType failed:', err)
      return null
    }
  }

  async updateBackend(
    targetBackendString: string
  ): Promise<{ wasUpdated: boolean; newBackend: string }> {
    targetBackendString = stripBom(targetBackendString)
    if (this.isUpdatingBackend) {
      logger.warn(
        'Backend update already in progress, skipping new update request'
      )
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

  /**
   * Downloads a recommended GPU backend and applies it without restarting
   * the app whenever possible. Called by the frontend when the user
   * confirms the better-backend popup.
   *
   * Sequencing rationale:
   *   1. Persist `llama_cpp_pending_backend` BEFORE the download so that any
   *      observer reacting to `AppEvent.onBackendDownloadFinished` sees the
   *      pending key already on disk (the download-finished event is emitted
   *      from inside `downloadAndInstallBackend` and previously beat the
   *      pending write, leaving the provider settings page without its
   *      "Restart to activate" pill until a tab refresh).
   *      `activatePendingBackend()` already gates on `isBackendInstalled()`,
   *      so a partial download leaves no harmful state.
   *   2. After a successful download, attempt `applyBackendLive()` for a
   *      hot-swap. On success the pending key is dropped and the UI reacts
   *      to `app:backend-hotswapped`. On failure the pending key stays put
   *      and the user falls back to the classic "restart required" flow.
   */
  async downloadRecommendedBackend(backendString: string): Promise<void> {
    backendString = stripBom(backendString)
    logger.info(`downloadRecommendedBackend: downloading ${backendString}`)
    localStorage.setItem('llama_cpp_pending_backend', backendString)
    try {
      await this.downloadAndInstallBackend(backendString)
    } catch (err) {
      // Download failed — drop the pending marker so the next app launch
      // doesn't try to "activate" a backend that was never installed.
      localStorage.removeItem('llama_cpp_pending_backend')
      throw err
    }
    localStorage.removeItem('llama_cpp_better_backend_recommendation')

    try {
      await this.applyBackendLive(backendString)
      logger.info(
        `downloadRecommendedBackend: applied backend ${backendString} live (no restart needed)`
      )
    } catch (err) {
      logger.warn(
        `downloadRecommendedBackend: hot-swap failed for ${backendString}, falling back to pending-restart flow:`,
        err
      )
    }
  }

  /**
   * Apply a freshly-downloaded backend to the running process: stop any
   * loaded llama.cpp models, swap `version_backend` via `updateBackend()`,
   * clear the pending marker, and notify the UI via a window event.
   *
   * Failure modes:
   *   - `unload()` throws when a session can't be cleanly stopped → we log
   *     and continue, because `updateBackend()` only mutates settings and
   *     does not require an empty session table.
   *   - `updateBackend()` throws → we propagate. Caller leaves the pending
   *     marker in place so `activatePendingBackend()` retries on next launch.
   */
  private async applyBackendLive(backendString: string): Promise<void> {
    let loaded: string[] = []
    try {
      loaded = await this.getLoadedModels()
    } catch (err) {
      logger.warn('applyBackendLive: getLoadedModels failed (continuing):', err)
    }

    for (const modelId of loaded) {
      try {
        await this.unload(modelId)
      } catch (err) {
        logger.warn(
          `applyBackendLive: failed to unload model ${modelId} (continuing):`,
          err
        )
      }
    }

    const result = await this.updateBackend(backendString)
    if (!result.wasUpdated) {
      throw new Error(
        `updateBackend reported wasUpdated=false for ${backendString}`
      )
    }

    localStorage.removeItem('llama_cpp_pending_backend')

    // Decoupled from `AppEvent` enum on purpose: a hot-swap completion is
    // a pure UI concern (the dialog/pill in the web app) and does not
    // need to traverse the cross-extension event bus. `window` is always
    // available inside the Tauri WebView2 context where this extension
    // runs.
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(
        new CustomEvent('app:backend-hotswapped', {
          detail: { backend: backendString },
        })
      )
    }
  }

  /**
   * Manually re-runs hardware detection and returns a recommendation if a
   * better GPU backend than the current one is available. Used by:
   *   - the dedicated Windows onboarding step (`SetupBackendStep`) to surface
   *     the recommendation deterministically, even after the early/late
   *     auto-emit gates have been disabled by `llama_cpp_onboarding_done`;
   *   - the manual "Find optimal backend" button in provider settings.
   *
   * Side effects (kept consistent with `configureBackends()` early-phase):
   *   - Writes `llama_cpp_better_backend_recommendation` to localStorage so
   *     the existing `useBackendUpdater` mount path picks it up too.
   *   - Emits `AppEvent.onBetterBackendDetected` so the dialog/component
   *     listening through the hook reflects the latest state.
   *
   * Returns the recommendation payload, or `null` when the device is already
   * on the optimal backend category (or detection couldn't decide).
   */
  async recheckOptimalBackend(): Promise<{
    currentBackend: string
    recommendedBackend: string
    recommendedCategory: string
  } | null> {
    if (IS_MAC) {
      return null
    }
    try {
      logger.info('recheckOptimalBackend: detecting ideal backend type')
      const idealType = await this.detectIdealBackendType()
      if (!idealType) {
        // CPU is already the best the hardware can do, or detection failed.
        logger.info(
          'recheckOptimalBackend: no GPU backend recommended (CPU is optimal or detection failed)'
        )
        localStorage.removeItem('llama_cpp_better_backend_recommendation')
        return null
      }

      const idealCat = get_backend_category(idealType)
      const currentBackend = stripBom(this.config.version_backend || '')
      const currentType = currentBackend.split('/')[1] || ''
      const currentCat = get_backend_category(currentType)
      if (idealCat === currentCat) {
        // Already on the optimal family — no recommendation to surface.
        logger.info(
          `recheckOptimalBackend: already on optimal category ${currentCat} (${currentBackend})`
        )
        localStorage.removeItem('llama_cpp_better_backend_recommendation')
        return null
      }

      // Build the recommendation from the currently-installed backend
      // version. We deliberately do NOT call `listSupportedBackends()`
      // here — that round-trips to api.github.com and was observed to
      // hang the manual "Find optimal backend" button under slow
      // networks / rate-limited responses.
      //
      // Using the current version is safe because:
      //   - Atomic Chat ships with a known bundled `version_backend`,
      //     so `currentBackend.split('/')[0]` is always a real GitHub
      //     release tag (e.g. `b8770`) with all per-platform variants.
      //   - `configureBackends()` on the next launch resolves the
      //     installed family to its latest version via
      //     `findLatestVersionForBackend()` — version drift is
      //     handled by the existing version-update toast, not here.
      const fallbackVersion = currentBackend.split('/')[0] || 'latest'
      const recommendedBackend = `${fallbackVersion}/${idealType}`

      const payload = {
        currentBackend,
        recommendedBackend,
        recommendedCategory: backendCategoryToLabel(idealCat),
      }
      logger.info(
        `recheckOptimalBackend: surfacing recommendation ${recommendedBackend} (${payload.recommendedCategory})`
      )
      localStorage.setItem(
        'llama_cpp_better_backend_recommendation',
        JSON.stringify(payload)
      )
      if (events && typeof events.emit === 'function') {
        events.emit(AppEvent.onBetterBackendDetected, payload)
      }
      return payload
    } catch (err) {
      logger.warn('recheckOptimalBackend failed:', err)
      return null
    }
  }

  async checkBackendForUpdates(): Promise<{
    updateNeeded: boolean
    newVersion: string
    targetBackend?: string
  }> {
    try {
      const currentBackend = this.config.version_backend
      if (!currentBackend || !currentBackend.includes('/')) {
        return { updateNeeded: false, newVersion: '0' }
      }

      const version_backends = await listSupportedBackends()
      if (version_backends.length === 0) {
        return { updateNeeded: false, newVersion: '0' }
      }

      const result = await checkBackendForUpdatesFromRust(
        currentBackend,
        version_backends
      )
      return {
        updateNeeded: result.update_needed,
        newVersion: result.new_version,
        targetBackend: result.target_backend ?? undefined,
      }
    } catch (err) {
      logger.warn('checkBackendForUpdates failed:', err)
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
    if (this.unlistenAutoIncreaseCtx) {
      this.unlistenAutoIncreaseCtx()
    }
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === 'version_backend') {
      // Skip entirely if updateBackend() is already handling it —
      // updateBackend() will commit to in-memory config itself after all
      // side effects succeed.
      if (this.isUpdatingBackend) {
        return
      }
      // During initialization, configureBackends handles all backend
      // setup; any updateSettings calls (e.g. BOM migration) should
      // only touch in-memory config without triggering downloads.
      if (this.isInitializing || this.isConfiguringBackends) {
        if (typeof value === 'string') {
          this.config[key] = stripBom(value) as any
        } else {
          this.config[key] = value
        }
        return
      }
    }

    if (key === 'version_backend' && typeof value === 'string') {
      value = stripBom(value) as T
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

    const newBackendString = `${version}/${backendIdentifier}`

    try {
      await this.configureBackends()

      // Auto-select the newly installed backend
      const effectiveBackendType = await mapOldBackendToNew(backendIdentifier)
      this.setStoredBackendType(effectiveBackendType)
      this.config.version_backend = newBackendString

      const settings = await this.getSettings()
      await this.updateSettings(
        settings.map((item) => {
          if (item.key === 'version_backend') {
            item.controllerProps.value = newBackendString
          }
          return item
        })
      )

      if (events && typeof events.emit === 'function') {
        events.emit('settingsChanged', {
          key: 'version_backend',
          value: newBackendString,
        })
      }

      logger.info(`Backend ${newBackendString} installed and auto-selected`)
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
    const resumeDownload = (opts as ImportOptions & { resume?: boolean }).resume

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
          onProgress,
          resumeDownload ?? false
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
            await this.abortImport(modelId)
          } catch (cancelError) {
            logger.warn('Failed to cancel download task:', cancelError)
          }

          await this.deleteModelFolder(modelId)

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
    if (this.configureBackendsPromise) {
      const vb = this.config.version_backend || ''
      if (!vb || vb === 'none' || !vb.includes('/')) {
        logger.info(
          `Waiting for backend configuration to complete before loading model "${modelId}"...`
        )
        await this.configureBackendsPromise
      } else {
        logger.info(
          `Backend already configured (${vb}), loading model "${modelId}" without waiting for full backend list`
        )
      }
    }

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
              return (
                this.sessionCache.get(modelId) ??
                (await this.findSessionByModel(modelId))
              )
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
        'Llama.cpp backend is not configured (version_backend is missing or invalid). Check Settings → Llama.cpp — Version & Backend, or reinstall the application.'
      )
    }

    // Version-aware flash_attn handling:
    // llama.cpp b6325+ changed --flash-attn from a boolean flag to a string
    // For older versions, "auto" is not a valid value so we fall back to "off"
    // (i.e. don't send the flag at all).
    if (cfg.flash_attn === 'auto' && !backend.startsWith('ik')) {
      const buildNum = parseBuildNumber(version)
      if (buildNum !== null && buildNum < 6325) {
        cfg.flash_attn = 'off'
      }
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
    if (typeof cfg.fit === 'string') cfg.fit = true

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
      this.sessionCache.set(modelId, sInfo)
      if (typeof cfg.ctx_size === 'number') {
        this.modelCtxSize.set(modelId, cfg.ctx_size)
      }
      return sInfo
    } catch (error) {
      logger.error('Error in load command:\n', error)
      throw error
    }
  }

  /// Bridge from the Local API Server proxy (Rust) back to the extension
  /// when a forwarded request exhausts the model's context window. We
  /// unload + reload the model with a larger ctx_size, inform the proxy via
  /// a request-scoped done event, and notify the web-app UI so the Zustand
  /// provider store mirrors the new value (so the next UI interaction keeps
  /// using the expanded window).
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
        this.modelCtxSize.get(model_id) ?? this.config?.ctx_size ?? 8192
      const newCtxLen = computeNextCtxLen(currentCtxLen)

      if (newCtxLen <= currentCtxLen) {
        await sendDone({ ok: false, reason: 'at_max' })
        return
      }

      logger.info(
        `auto_increase_ctx (llamacpp) model=${model_id} trigger=${trigger} ${currentCtxLen} -> ${newCtxLen}`
      )

      // Unload may throw if the session is gone; treat that as a reload
      // candidate but still bail on the load step since we can't retry
      // against a missing process.
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

      // Redundant Tauri-level broadcast so the web-app can listen on the
      // native event bus without depending on `@janhq/core`'s in-process
      // EventEmitter singleton (which can be bypassed when extensions bundle
      // their own copy of `@janhq/core`).
      try {
        await tauriEmit(AUTO_INCREASE_CTX_NOTIFY, notifyPayload)
      } catch (e) {
        logger.warn(
          `Failed to Tauri-emit ${AUTO_INCREASE_CTX_NOTIFY}: ${e}`
        )
      }

      await sendDone({
        ok: true,
        new_ctx_len: newCtxLen,
      })
      logger.info(
        `auto_increase_ctx (llamacpp) reload complete model=${model_id} port=${sInfo?.port} newCtxLen=${newCtxLen}; notified UI via events + tauri`
      )
    } catch (e) {
      logger.error(
        `auto_increase_ctx handler failed for ${payload.model_id}: ${e}`
      )
      await sendDone({ ok: false, reason: `exception: ${e}` })
    }
  }

  override async unload(modelId: string): Promise<UnloadResult> {
    const sInfo: SessionInfo =
      this.sessionCache.get(modelId) ?? (await this.findSessionByModel(modelId))
    if (!sInfo) {
      throw new Error(`No active session found for model: ${modelId}`)
    }
    const pid = sInfo.pid
    try {
      const result = await unloadLlamaModel(pid)

      if (result.success) {
        this.sessionCache.delete(modelId)
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
    backend = stripBom(backend)
    version = stripBom(version)
    const backendKey = `${version}/${backend}`
    if (await isBackendInstalled(backend, version)) {
      return
    }

    // Only attempt auto-download for janhq/llama.cpp backends (Windows/Linux).
    // macOS turboquant backends come from a different repo and must be bundled.
    if (!IS_MAC) {
      logger.info(
        `Backend ${backendKey} not installed locally, attempting download...`
      )
      try {
        await this.downloadAndInstallBackend(backendKey)
      } catch (err) {
        logger.error(`Failed to download backend ${backendKey}:`, err)
      }

      if (await isBackendInstalled(backend, version)) {
        return
      }
    }

    throw new Error(
      `Backend ${backendKey} is not installed and could not be downloaded. Check your internet connection or try reinstalling the app.`
    )
  }

  /**
   * Downloads a backend archive from janhq/llama.cpp GitHub releases and
   * extracts it into the local backends directory.
   */
  private async downloadAndInstallBackend(
    backendString: string
  ): Promise<void> {
    backendString = stripBom(backendString)
    const parts = backendString.split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid backend string: ${backendString}`)
    }
    const [version, backend] = [stripBom(parts[0]), stripBom(parts[1])]

    if (await isBackendInstalled(backend, version)) {
      logger.info(
        `Backend ${backendString} is already installed, skipping download`
      )
      return
    }

    const url = getBackendDownloadUrl(version, backend)
    const janDataFolderPath = await getJanDataFolderPath()
    const tempDir = await joinPath([janDataFolderPath, 'llamacpp', 'tmp'])
    if (!(await fs.existsSync(tempDir))) {
      await fs.mkdir(tempDir)
    }
    const archiveName = `llama-${version}-bin-${backend}.tar.gz`
    const archivePath = await joinPath([tempDir, archiveName])
    const targetDir = await getBackendDir(backend, version)

    logger.info(`Downloading backend ${backendString} from ${url}`)

    if (events && typeof events.emit === 'function') {
      events.emit(AppEvent.onBackendDownloadStarted, {
        backend: backendString,
        status: 'downloading',
      })
    }

    try {
      // Route the file transfer through `download-extension` so the
      // standard top-left download manager picks it up via the same
      // `DownloadEvent.onFileDownloadUpdate` channel that model
      // downloads use. The legacy `AppEvent.onBackendDownload*`
      // events are still emitted because the BackendUpdater dialog
      // listens to them for the recommend → downloading →
      // restart-required state machine.
      //
      // Prefix the taskId with `llamacpp-backend-` so the cancel
      // button in the standard UI takes the
      // `download.id.startsWith('llamacpp')` branch and can call
      // `cancelDownload(taskId)` instead of the model-abort path.
      const taskId = `llamacpp-backend-${version}/${backend}`
      const downloadManager = window.core?.extensionManager?.getByName(
        '@janhq/download-extension'
      ) as
        | {
            downloadFiles?: (
              items: { url: string; save_path: string }[],
              taskId: string,
              onProgress?: (transferred: number, total: number) => void,
              resume?: boolean
            ) => Promise<void>
          }
        | undefined

      const onProgress = (transferred: number, total: number) => {
        if (events && typeof events.emit === 'function') {
          events.emit(DownloadEvent.onFileDownloadUpdate, {
            modelId: taskId,
            percent: total > 0 ? transferred / total : 0,
            size: { transferred, total },
            downloadType: 'Backend',
          })
        }
      }

      if (downloadManager?.downloadFiles) {
        await downloadManager.downloadFiles(
          [{ url, save_path: archivePath }],
          taskId,
          onProgress,
          false
        )
      } else {
        // Best-effort fallback when the download-extension is not
        // available — preserves backend installation but the standard
        // UI won't reflect progress.
        logger.warn(
          'download-extension not available, falling back to raw download_files invoke'
        )
        await invoke<void>('download_files', {
          items: [{ url, save_path: archivePath }],
          taskId,
          headers: {},
          resume: false,
        })
      }

      logger.info(`Download complete, extracting to ${targetDir}`)
      await invoke('decompress', {
        path: archivePath,
        outputDir: targetDir,
      })

      const exeName = IS_WINDOWS ? 'llama-server.exe' : 'llama-server'
      const expectedBin = await joinPath([targetDir, 'build', 'bin', exeName])

      if (!(await fs.existsSync(expectedBin))) {
        const flatBin = await joinPath([targetDir, exeName])
        if (await fs.existsSync(flatBin)) {
          logger.info('Relocating flat-extracted binaries into build/bin/')
          const buildBinDir = await joinPath([targetDir, 'build', 'bin'])
          await fs.mkdir(buildBinDir)
          const entries = await fs.readdirSync(targetDir)
          for (const entry of entries) {
            if (entry === 'build') continue
            const src = await joinPath([targetDir, entry])
            const dst = await joinPath([buildBinDir, entry])
            await fs.copyFile(src, dst)
          }
        }
      }

      if (!(await isBackendInstalled(backend, version))) {
        throw new Error(
          `Backend extracted but llama-server binary not found at expected path`
        )
      }

      logger.info(`Backend ${backendString} installed successfully`)

      if (events && typeof events.emit === 'function') {
        // Clear from the standard download manager UI.
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
          modelId: `llamacpp-backend-${backendString}`,
          downloadType: 'Backend',
        })
        events.emit(AppEvent.onBackendDownloadFinished, {
          backend: backendString,
          status: 'completed',
        })
      }
    } catch (downloadErr) {
      const errorMessage =
        downloadErr instanceof Error
          ? downloadErr.message
          : String(downloadErr)
      if (events && typeof events.emit === 'function') {
        // Clear the standard download manager row on failure too.
        events.emit(DownloadEvent.onFileDownloadError, {
          modelId: `llamacpp-backend-${backendString}`,
          error: errorMessage,
          downloadType: 'Backend',
        })
        events.emit(AppEvent.onBackendDownloadFinished, {
          backend: backendString,
          status: 'failed',
          error: errorMessage,
        })
      }
      throw downloadErr
    } finally {
      try {
        if (await fs.existsSync(archivePath)) {
          await fs.rm(archivePath)
        }
      } catch {
        // best-effort cleanup
      }
    }
  }

  private async *handleStreamingResponse(
    url: string,
    headers: HeadersInit,
    body: string,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    // Stream via Tauri IPC Channel instead of the intercepted global fetch.
    // tauri_plugin_http overrides window.fetch and routes requests through
    // reqwest, but its ReadableStream bridge may not properly relay SSE chunks
    // back to the webview. Using a dedicated Tauri command + Channel bypasses
    // the plugin entirely.

    const rawChunks: string[] = []
    let streamDone = false
    let streamError: Error | null = null
    let wakeUp: (() => void) | null = null

    const channel = new Channel<{ data: string }>()
    channel.onmessage = (event: { data: string }) => {
      logger.info('[stream] chunk received, length:', event.data.length)
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
    logger.info(
      '[stream] invoking stream_local_http, url:',
      url,
      'timeout:',
      timeoutNum
    )

    const requestPromise = invoke<number>('stream_local_http', {
      url,
      headers: headersRecord,
      body,
      timeoutSecs: timeoutNum,
      onChunk: channel,
    })

    requestPromise
      .then((status) => {
        logger.info('[stream] invoke resolved, status:', status)
        streamDone = true
        if (wakeUp) {
          wakeUp()
          wakeUp = null
        }
      })
      .catch((e) => {
        logger.error('[stream] invoke rejected:', String(e))
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

          let jsonStr = ''
          if (trimmedLine.startsWith('data: ')) {
            jsonStr = trimmedLine.slice(6)
          } else if (trimmedLine.startsWith('error: ')) {
            jsonStr = trimmedLine.slice(7)
            const error = JSON.parse(jsonStr)
            throw new Error(error.message)
          } else {
            throw new Error('Malformed chunk')
          }
          try {
            const data = JSON.parse(jsonStr)
            const chunk = data as chatCompletionChunk

            if (chunk.choices?.[0]?.finish_reason === 'length') {
              throw new Error(OUT_OF_CONTEXT_SIZE)
            }

            yield chunk
          } catch (e) {
            logger.error('Error parsing JSON from stream or server error:', e)
            throw e
          }
        }
      }

      if (streamDone) {
        if (streamError) throw streamError
        break
      }
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
    const sessionInfo =
      this.sessionCache.get(opts.model) ??
      (await this.findSessionByModel(opts.model))
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }
    const result = await invoke<boolean>('plugin:llamacpp|is_process_running', {
      pid: sessionInfo.pid,
    })
    if (result) {
      try {
        await globalThis.fetch(`http://localhost:${sessionInfo.port}/health`)
      } catch (e) {
        this.sessionCache.delete(opts.model)
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
    // Handle non-streaming response – use globalThis.fetch to bypass
    // tauri_plugin_http whose ReadableStream bridge may hang on response body.
    const response = await globalThis.fetch(url, {
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
    if (this.configureBackendsPromise) {
      const vb = this.config.version_backend || ''
      if (!vb || vb === 'none' || !vb.includes('/')) {
        await this.configureBackendsPromise
      }
    }

    const cfg = this.config
    const [version, backend] = cfg.version_backend.split('/')
    if (!version || !backend) {
      throw new Error(
        'Llama.cpp backend is not configured (version_backend is missing or invalid). Check Settings → Llama.cpp — Version & Backend, or reinstall the application.'
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
      // Use globalThis.fetch to bypass tauri_plugin_http's intercepted fetch
      // whose ReadableStream bridge does not properly relay the response body.
      const response = await globalThis.fetch(baseUrl, {
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
    if (!opts.messages || opts.messages.length === 0) {
      return 0
    }

    const sessionInfo =
      this.sessionCache.get(opts.model) ??
      (await this.findSessionByModel(opts.model))
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }

    const baseUrl = `http://localhost:${sessionInfo.port}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionInfo.api_key}`,
    }

    let imageTokens = 0
    const hasImages = opts.messages.some(
      (msg) =>
        Array.isArray(msg.content) &&
        msg.content.some((content) => content.type === 'image_url')
    )

    if (hasImages) {
      logger.info('Conversation has images')
      try {
        logger.info(`MMPROJ PATH: ${sessionInfo.mmproj_path}`)
        const metadata = await readGgufMetadata(sessionInfo.mmproj_path)
        logger.info(`mmproj metadata: ${JSON.stringify(metadata.metadata)}`)
        imageTokens = await this.calculateImageTokens(
          opts.messages,
          metadata.metadata
        )
      } catch (error) {
        logger.warn('Failed to calculate image tokens:', error)
        imageTokens = this.estimateImageTokensFallback(opts.messages)
      }
    }

    const tokenizeRequest = {
      messages: opts.messages,
      chat_template_kwargs: opts.chat_template_kwargs || {
        enable_thinking: false,
      },
    }

    try {
      console.debug('[TokenCounter:ext] calling /apply-template via invoke')
      const applyResult = await invoke<string>('post_local_http', {
        url: `${baseUrl}/apply-template`,
        headers,
        body: JSON.stringify(tokenizeRequest),
        timeoutSecs: 10,
      })
      const parsedPrompt = JSON.parse(applyResult)
      console.debug(
        '[TokenCounter:ext] /apply-template done, promptLen:',
        parsedPrompt.prompt?.length
      )

      const tokenizeResult = await invoke<string>('post_local_http', {
        url: `${baseUrl}/tokenize`,
        headers,
        body: JSON.stringify({ content: parsedPrompt.prompt }),
        timeoutSecs: 10,
      })
      const dataTokens = JSON.parse(tokenizeResult)
      const textTokens = dataTokens.tokens?.length || 0
      console.debug(
        '[TokenCounter:ext] done, textTokens:',
        textTokens,
        'imageTokens:',
        imageTokens
      )

      return textTokens + imageTokens
    } catch (e) {
      console.warn('[TokenCounter:ext] error in tokenize chain:', String(e))
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
