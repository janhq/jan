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
  fetchRemoteBackends,
  friendlyBackendLabel,
  getBackendDownloadUrl,
  getCudartDownloadUrl,
  getCudartArchiveName,
  getCudaToolkitVersion,
} from './backend'
import { invoke, Channel } from '@tauri-apps/api/core'
import {
  getProxyConfig,
  buildEmbedBatches,
  mergeEmbedResponses,
  type EmbedBatchResult,
} from './util'
import {
  resolveGemmaMtpDraft,
  checkGemmaMtpSupport,
  gemmaMtpDraftUrl,
  type GemmaMtpDraft,
} from './gemmaMtpRegistry'
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
  isCudaInstalledFromRust,
} from '../../../src-tauri/plugins/tauri-plugin-llamacpp-upstream/guest-js/index'

// Error message constant - matches web-app/src/utils/error.ts
const OUT_OF_CONTEXT_SIZE = 'the request exceeds the available context size.'

/// Payload emitted by the Rust proxy when it detects a context-limit error
/// that we (the TS side) should recover from by reloading the backend with
/// a larger ctx window.
interface AutoIncreaseCtxRequest {
  request_id: string
  backend: 'llamacpp' | 'llamacpp-upstream' | 'mlx'
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
/// Broadcast channel emitted when auto-expand hits the model's true
/// training-max context (or when the next ladder step doesn't grow the
/// window further). The web-app uses this to show a one-shot toast and
/// stop driving further regeneration attempts.
const AUTO_INCREASE_CTX_AT_MAX = 'local_backend://auto_increase_ctx_at_max'

/// Error code (SCREAMING_SNAKE_CASE) surfaced by the Rust plugin's
/// `LlamacppError` when an mmproj declares a projector type the bundled
/// llama.cpp/libmtmd build cannot parse (e.g. Gemma 4 `gemma4a` audio).
/// On this error we retry the load text-only (without --mmproj).
const ERR_MULTIMODAL_PROJECTOR_LOAD_FAILED = 'MULTIMODAL_PROJECTOR_LOAD_FAILED'
/// Broadcast channel emitted after a model that crashed on an unsupported
/// multimodal projector is successfully reloaded in text-only mode. The
/// web-app shows a one-shot, non-fatal toast so the user knows vision/audio
/// was disabled for this model on the current backend.
const MULTIMODAL_DISABLED_FALLBACK =
  'local_backend://multimodal_disabled_fallback'

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
    case 'cuda-cu13': return 'CUDA 13'
    case 'cuda-cu13.0': return 'CUDA 13'
    case 'cuda-cu12.4': return 'CUDA 12'
    case 'cuda-cu12.0': return 'CUDA 12'
    case 'cuda-cu11.7': return 'CUDA 11'
    case 'vulkan': return 'Vulkan'
    default: return category
  }
}

function get_backend_category(backend: string): string {
  // ggml-org native Windows names (matched first so `cuda-13.x` / `cuda-12.4`
  // don't fall through to the legacy janhq categories).
  if (/cuda-13\.\d+/.test(backend)) return 'cuda-cu13'
  if (backend.includes('cuda-12.4')) return 'cuda-cu12.4'
  // Legacy janhq mirror names.
  if (backend.includes('cuda-13-common_cpus')) return 'cuda-cu13.0'
  if (backend.includes('cuda-12-common_cpus') || backend.includes('cu12.0'))
    return 'cuda-cu12.0'
  if (backend.includes('cuda-11-common_cpus') || backend.includes('cu11.7'))
    return 'cuda-cu11.7'
  if (backend.includes('vulkan')) return 'vulkan'
  if (backend === 'win-cpu-x64' || backend === 'win-cpu-arm64') return 'cpu'
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

/**
 * The on-disk subfolder used by BOTH llama.cpp providers (turboquant fork
 * and upstream `ggml-org/llama.cpp`) for model storage. Backends and
 * provider-specific settings stay separate under each provider's own
 * folder; only the GGUF tree is shared so a model downloaded once is
 * runnable by either engine.
 */
const MODELS_PROVIDER_ROOT = 'llamacpp'

export default class llamacpp_upstream_extension extends AIEngine {
  provider: string = 'llamacpp-upstream'
  autoUnload: boolean = false
  timeout: number = 600
  llamacpp_env: string = ''
  readonly providerId: string = 'llamacpp-upstream'

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
  /// Cached upper bound for a model's context window, read from the GGUF
  /// metadata key `{general.architecture}.context_length`. Acts as the hard
  /// ceiling for the auto-expand-ctx ladder so we don't keep trying to grow
  /// past what the model's positional embeddings actually support.
  private modelMaxCtxTrain = new Map<string, number>()
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

    // NOTE: v2 turbo3 KV-cache migration is intentionally skipped for the
    // upstream provider — vanilla ggml-org/llama.cpp does not implement the
    // turboquant KV types.

    // Migration v3: disable fit by default
    await this.migrateFitDefault()

    // Migration v4: stop overriding KV cache types in the upstream
    // provider. Earlier we forced `q8_0` to mirror the TurboQuant fork,
    // but vanilla `llama-server` performs best with its own default
    // (`f16`). We drop the obsolete `cache_type_k` / `cache_type_v`
    // entries from the persisted settings list and clear the in-memory
    // config so `args.rs` skips emitting `--cache-type-k/-v` entirely.
    await this.clearLegacyKvCacheSettings()

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
        // The Rust proxy emits `backend: 'llamacpp-upstream'` for sessions
        // owned by the upstream `LlamacppState` pool; only those events
        // belong to this extension. Turboquant sessions are handled by the
        // `llamacpp-extension` listener.
        if (event.payload?.backend !== 'llamacpp-upstream') return
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

  private async clearLegacyKvCacheSettings(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_upstream_kv_cache_cleared_v1'
    if (localStorage.getItem(MIGRATION_KEY)) return

    const obsoleteKeys = ['cache_type_k', 'cache_type_v'] as const

    try {
      const settings = await this.getSettings()
      const filtered = settings.filter(
        (item) =>
          !(obsoleteKeys as readonly string[]).includes(item.key as string)
      )
      if (filtered.length !== settings.length) {
        await this.updateSettings(filtered)
      }
    } catch (err) {
      logger.warn(
        'clearLegacyKvCacheSettings: failed to prune settings list:',
        err
      )
    }

    const cfg = this.config as Record<string, unknown>
    for (const k of obsoleteKeys) {
      if (cfg[k] !== undefined && cfg[k] !== '') {
        cfg[k] = ''
      }
    }

    localStorage.setItem(MIGRATION_KEY, '1')
    logger.info(
      'Cleared legacy KV cache type overrides; falling back to llama.cpp defaults'
    )
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
        this.providerId,
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

      // Static "Latest <variant>" dropdown entries for every variant the
      // upstream release stream ships on this OS. Built from the compile-time
      // `IS_WINDOWS` / `IS_LINUX` constants (no network, no hardware probe) so
      // they ALWAYS appear — even when the remote backend fetch below hangs or
      // fails. Each carries a `latest/<backend>` sentinel; `onSettingUpdate`
      // resolves it to the newest release tag at selection time. The set is
      // intentionally unfiltered by hardware — a deliberate manual override so
      // the user can force-install e.g. CUDA even when the driver gate would
      // normally hide it.
      const staticVariants: string[] = IS_WINDOWS
        ? [
            'win-cpu-x64',
            'win-cuda-12.4-x64',
            'win-cuda-13.3-x64',
            'win-vulkan-x64',
          ]
        : IS_LINUX
          ? ['linux-cpu-x64', 'linux-vulkan-x64']
          : []
      const latestEntries = staticVariants.map((backend) => ({
        value: `latest/${backend}`,
        name: `Latest ${friendlyBackendLabel(backend)}`,
      }))

      // --- Early settings registration with bundled backend ---
      // Register settings with the static "Latest" entries plus at least the
      // bundled backend so the UI isn't stuck in "loading" — and so the
      // manual-variant picker is usable — while the GitHub API responds (or
      // hangs).
      if (bundledBackendString) {
        const earlySettings = structuredClone(SETTINGS)
        const earlyBackendIdx = earlySettings.findIndex(
          (item) => item.key === 'version_backend'
        )
        if (earlyBackendIdx !== -1) {
          const earlySetting = earlySettings[earlyBackendIdx]
          const currentVB = this.config.version_backend || ''
          const earlyOptions = [...latestEntries]
          if (
            currentVB &&
            currentVB !== bundledBackendString &&
            !earlyOptions.some((o) => o.value === currentVB)
          ) {
            earlyOptions.push({ value: currentVB, name: currentVB })
          }
          if (!earlyOptions.some((o) => o.value === bundledBackendString)) {
            earlyOptions.push({
              value: bundledBackendString,
              name: bundledBackendString,
            })
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

        // Build the dropdown option-litany in two tiers:
        //   1. The STATIC "Latest <variant>" entries computed near the top of
        //      this method (also used by the early registration above).
        //   2. The versions already installed on disk, shown raw below.
        let installedEntries: Array<{ value: string; name: string }> = []
        try {
          installedEntries = (await getLocalInstalledBackends()).map((b) => {
            const key = `${b.version}/${b.backend}`
            return { value: key, name: key }
          })
        } catch (err) {
          logger.warn(
            `[configureBackends] Failed to list installed backends: ${
              err instanceof Error ? err.message : err
            }`
          )
        }

        let backendOptions: Array<{ value: string; name: string }> = [
          ...latestEntries,
          ...installedEntries,
        ]

        // Last-resort fallback: if we somehow produced no options at all
        // (e.g. unsupported OS and nothing installed), fall back to the
        // hardware-gated merged list so the dropdown is never empty.
        if (backendOptions.length === 0) {
          backendOptions = version_backends.map((b) => {
            const key = `${b.version}/${b.backend}`
            return { value: key, name: key }
          })
        }

        backendSetting.controllerProps.options = backendOptions

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

      // Force-switch to the bundled backend when it is a newer version of the
      // SAME backend type (e.g. macos-arm64 → macos-arm64 on app update).
      // The upstream extension is macOS-only; there is no turboquant
      // migration step here — that pipeline lives in the sibling extension.
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

        if (isBundledNewer) {
          logger.info(
            `Switching backend from '${effectiveBackendString}' to bundled '${bundledBackendString}' (app update)`
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
   * (e.g. "win-cuda-13.4-x64") or null if CPU is already optimal.
   *
   * Naming differs by platform — Windows uses ggml-org native ids
   * (`win-cuda-{12.4,13.3}-x64`, `win-vulkan-x64`); Linux still uses the
   * janhq-mirror names (`linux-cuda-{12,13}-common_cpus-x64`) because the
   * upstream extension is currently only wired on macOS and Windows.
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

      if (sysInfo.os_type === 'windows') {
        const availableBackends = await listSupportedBackends()
        const pickBackend = (pattern: RegExp): string | null => {
          const candidate = availableBackends.find((b) => pattern.test(b.backend))
          return candidate?.backend ?? null
        }

        const cuda13Backend = pickBackend(
          new RegExp(`^win-cuda-13\\.\\d+-${archSuffix}$`)
        )
        const cuda12Backend = pickBackend(
          new RegExp(`^win-cuda-12\\.4-${archSuffix}$`)
        )
        const vulkanBackend = pickBackend(
          new RegExp(`^win-vulkan-${archSuffix}$`)
        )

        // ggml-org publishes Windows CUDA 13.x and 12.4 builds —
        // CUDA 11 has been dropped upstream. Hosts with driver too old
        // for CUDA 12.4 (~551.61) fall through to Vulkan/CPU below via
        // the feature-flag gating in `get_supported_features`.
        //
        // Tiers are checked top-down with a *conservative* runtime probe:
        // an installed backend is only skipped when `--list-devices` is
        // empty AND the hardware plugin (NVML / Vulkan loader) cannot
        // corroborate the existence of a matching GPU. This guard exists
        // because real-world data (nvidia-smi on AtomicBot-ai/Atomic-Chat#25,
        // 2026-05-26: driver 596.49, CUDA 13.2, `llama-server.exe`
        // visible as Compute process with 15.6 GiB VRAM in use) showed
        // that `--list-devices` can return empty stdout on hosts where
        // the same binary's real inference path uses CUDA happily. Using
        // `--list-devices` alone as a degrade trigger would push those
        // users off a working CUDA-13.1 onto CUDA-12.4 / Vulkan / CPU.
        const tiers: string[] = []
        if (features.cuda13 && cuda13Backend) tiers.push(cuda13Backend)
        if (features.cuda12 && cuda12Backend) tiers.push(cuda12Backend)
        if (features.vulkan && hasEnoughVram && vulkanBackend)
          tiers.push(vulkanBackend)

        for (const tier of tiers) {
          const probe = await this.tierEnumeratesDevices(tier, sysInfo)
          if (probe !== 'broken') {
            return tier
          }
        }
        return null
      }

      // Linux — per 2026-05-28 ADR *Linux ships only `llamacpp-upstream`*,
      // the only GPU-accelerated backend `ggml-org/llama.cpp` publishes for
      // Linux is Vulkan. There are no `ubuntu-cuda-*` release artefacts,
      // so even on NVIDIA hosts the optimal upgrade path is Vulkan (which
      // works with the proprietary NVIDIA driver's Vulkan ICD just fine).
      // `features.vulkan` is only `true` when libvulkan.so.1 loaded AND
      // `vkEnumeratePhysicalDevices` returned ≥1 GPU — so this branch
      // never recommends Vulkan on a host that can't actually run it.
      //
      // The `cuda*` feature flags are intentionally ignored here; they
      // can still be true on a Linux box with a recent NVIDIA driver,
      // but recommending a CUDA backend we don't ship would just produce
      // a 404 at download time. `determine_supported_backends` in the
      // Rust plugin mirrors this matrix.
      if (sysInfo.os_type === 'linux') {
        if (features.vulkan && hasEnoughVram && archSuffix === 'x64') {
          return 'linux-vulkan-x64'
        }
        return null
      }

      return null
    } catch (err) {
      logger.warn('detectIdealBackendType failed:', err)
      return null
    }
  }

  /**
   * Non-destructive runtime probe for whether a given backend tier can
   * actually enumerate GPU devices on this host.
   *
   * Returns a tri-state because `--list-devices` is not a reliable
   * "this tier is broken" signal on its own (see ADR 2026-05-26):
   *   - `'works'`      — `--list-devices` returned ≥1 device. Tier is
   *                      definitely usable.
   *   - `'unverified'` — we have no negative signal strong enough to
   *                      reject the tier. Three sub-cases:
   *                        a) tier is not installed locally (no smoke
   *                           test possible);
   *                        b) tier is installed, `--list-devices` is
   *                           empty / threw, BUT the hardware plugin
   *                           (NVML / Vulkan) sees a matching GPU and
   *                           contradicts the empty enumeration.
   *                      Caller should treat `'unverified'` as acceptable
   *                      and keep the tier as the recommendation.
   *   - `'broken'`     — tier is installed, `--list-devices` is empty /
   *                      threw, AND the hardware plugin also has no
   *                      matching GPU. Two independent signals agree
   *                      this tier cannot use any GPU on this host.
   *                      Caller should degrade to the next tier.
   *
   * Rationale for the corroboration guard: nvidia-smi from the
   * AtomicBot-ai/Atomic-Chat#25 reporter (RTX 4090 Laptop, driver
   * 596.49, CUDA 13.2) showed `llama-server.exe` running as a Compute
   * process with 15.6 GiB VRAM in use, while `--list-devices` from the
   * same binary returned empty. Treating `--list-devices` emptiness as
   * a sole degrade trigger would have pushed that user (and the
   * cohort he represents) off a working CUDA-13.1 onto CUDA-12.4 /
   * Vulkan / CPU. The corroborating-GPU check from NVML / Vulkan
   * prevents that false-positive.
   *
   * Deliberately does NOT trigger a download — health checks must be
   * cheap. A degraded recommendation flows through the existing
   * download-backend UI path the same way as any other recommendation.
   */
  private async tierEnumeratesDevices(
    backendType: string,
    sysInfo: { gpus: Array<{ vendor: string }> }
  ): Promise<'works' | 'unverified' | 'broken'> {
    let installed: { backend: string; version: string } | undefined
    try {
      const local = await getLocalInstalledBackends()
      installed = local.find((b) => b.backend === backendType)
    } catch (err) {
      logger.warn(
        `Tier ${backendType} health-check: getLocalInstalledBackends threw (${
          err instanceof Error ? err.message : String(err)
        }); treating as unverified`
      )
      return 'unverified'
    }
    if (!installed) {
      return 'unverified'
    }

    let devices: DeviceList[] | null = null
    let probeError: string | null = null
    try {
      const backendPath = await getBackendExePath(
        installed.backend,
        installed.version
      )
      devices = await invoke<DeviceList[]>(
        'plugin:llamacpp-upstream|get_devices',
        { backendPath, envs: {} }
      )
    } catch (err) {
      probeError = err instanceof Error ? err.message : String(err)
    }

    if (devices && Array.isArray(devices) && devices.length > 0) {
      return 'works'
    }

    const corroborated = this.hasCorroboratingGpu(backendType, sysInfo)
    if (corroborated) {
      // NVML / Vulkan see a matching GPU but `--list-devices` did not —
      // most likely a parser / environment / cudart-search-path quirk
      // (see ADR 2026-05-26). Trust the hardware plugin and keep this
      // tier as the recommendation; the real inference path uses its
      // own CUDA init and is unaffected by `--list-devices` quirks.
      const reason = probeError
        ? `--list-devices threw (${probeError})`
        : '--list-devices returned no devices'
      logger.info(
        `Tier ${backendType} (${installed.version}) ${reason} but NVML/Vulkan corroborates a matching GPU; keeping tier as recommendation (unverified)`
      )
      return 'unverified'
    }

    // Two independent signals (`--list-devices` AND NVML/Vulkan) agree
    // this tier has no usable GPU on this host. Degrade.
    const reason = probeError
      ? `--list-devices threw (${probeError})`
      : '--list-devices returned no devices'
    logger.warn(
      `Tier ${backendType} (${installed.version}) is broken: ${reason} and the hardware plugin sees no matching GPU; degrading recommendation to next tier`
    )
    return 'broken'
  }

  /**
   * Returns true when the hardware plugin's GPU enumeration corroborates
   * that the given backend tier could plausibly use a GPU on this host.
   *
   *   - `win-cuda-*` / `linux-cuda-*` → at least one NVIDIA GPU detected
   *     by NVML.
   *   - `win-vulkan-*` / `linux-vulkan-*` → at least one GPU of any
   *     vendor detected (Vulkan enumeration runs through the Vulkan
   *     loader, which covers AMD / Intel / NVIDIA).
   *   - `*-cpu*` or anything else → corroboration is meaningless,
   *     return true so the picker can fall through.
   *
   * Vendor names match the strings serialised by
   * `tauri-plugin-hardware/src/types.rs` (`"NVIDIA" | "AMD" | "Intel" |
   * "Unknown (vendor_id: N)"`).
   */
  private hasCorroboratingGpu(
    backendType: string,
    sysInfo: { gpus: Array<{ vendor: string }> }
  ): boolean {
    if (backendType.includes('cuda')) {
      return sysInfo.gpus.some((g) => g.vendor === 'NVIDIA')
    }
    if (backendType.includes('vulkan')) {
      return sysInfo.gpus.length > 0
    }
    return true
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

    // The recommendation can carry a `latest/<backend>` sentinel (the
    // static "Latest <variant>" dropdown entries, and the offline fallback
    // in `recheckOptimalBackend`). `downloadAndInstallBackend` →
    // `getBackendDownloadUrl` would otherwise build a 404 URL with the
    // literal `latest` tag (ggml-org tags releases as `bXXXX`, never
    // `latest`). Resolve it to a concrete `<tag>/<backend>` here — mirroring
    // what `downloadManualBackend` already does — before anything touches
    // the download URL. (ATO-95)
    if (backendString.startsWith('latest/')) {
      const backendId = backendString.slice('latest/'.length).trim()
      const resolved =
        (await this.resolveLatestBackendString(backendId)) ??
        (await this.newestInstalledOfFamily(backendId))
      if (!resolved) {
        throw new Error(
          `Could not resolve a release for '${backendId}': the ggml-org release stream is unreachable and no version of this backend is installed locally.`
        )
      }
      logger.info(
        `downloadRecommendedBackend: resolved sentinel ${backendString} -> ${resolved}`
      )
      backendString = resolved
    }

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
      // ATO-104: bound the whole hardware/backend detection so the
      // onboarding "Detecting your hardware" step can never hang forever
      // on a stalled IPC or network lookup. On timeout we behave as if no
      // GPU backend was recommended (CPU is the safe fallback) instead of
      // leaving the spinner up indefinitely.
      const idealType = await this.withTimeout(
        this.detectIdealBackendType(),
        20_000,
        null
      )
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
      const sameCategory = idealCat === currentCat
      const sameBackendType = currentType === idealType
      if (sameCategory && sameBackendType) {
        // Already on the optimal exact backend — no recommendation to surface.
        logger.info(
          `recheckOptimalBackend: already on optimal backend ${currentBackend}`
        )
        localStorage.removeItem('llama_cpp_better_backend_recommendation')
        return null
      }

      // Prefer the latest concrete backend for the detected ideal type.
      // This handles in-family migrations such as CUDA 13.1 -> CUDA 13.3/13.4
      // when the currently-selected backend is still "optimal category"
      // but no longer the latest downloadable variant.
      let recommendedBackend: string | null = null
      try {
        // ATO-104: cap the supported-backends lookup (it fans out to a
        // GitHub release fetch) so detection terminates even when the
        // network stalls past the inner AbortController.
        const versionBackends = await this.withTimeout(
          listSupportedBackends(),
          20_000,
          []
        )
        recommendedBackend = await findLatestVersionForBackend(
          versionBackends,
          idealType
        )
      } catch (err) {
        logger.warn(
          `recheckOptimalBackend: failed to resolve latest backend for ${idealType}, falling back to current version: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
      if (!recommendedBackend) {
        // `listSupportedBackends()` / `findLatestVersionForBackend()` came
        // up empty (e.g. the ggml-org release fetch failed). Resolve a
        // concrete release tag for the ideal type directly rather than
        // emitting a `latest/<backend>` sentinel — the literal `latest`
        // produces a 404 download URL downstream (ATO-95).
        recommendedBackend = await this.withTimeout(
          this.resolveLatestBackendString(idealType),
          20_000,
          null
        )
        if (!recommendedBackend) {
          // Last resort: reuse the tag of the currently-installed backend,
          // but only when we actually have one. A bare `latest` tag is never
          // valid for ggml-org's `/releases/download/<tag>/...` asset path.
          const fallbackVersion = currentBackend.split('/')[0]
          if (!fallbackVersion) {
            logger.warn(
              `recheckOptimalBackend: could not resolve a concrete tag for ${idealType} and no current backend tag to fall back to — skipping recommendation`
            )
            localStorage.removeItem('llama_cpp_better_backend_recommendation')
            return null
          }
          recommendedBackend = `${fallbackVersion}/${idealType}`
        }
      }
      if (recommendedBackend === currentBackend) {
        logger.info(
          `recheckOptimalBackend: latest resolved backend is already active (${currentBackend})`
        )
        localStorage.removeItem('llama_cpp_better_backend_recommendation')
        return null
      }

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

  /**
   * Returns the SHARED models root for both llama.cpp providers
   * (turboquant + upstream). Always `<jan>/llamacpp/models`, regardless of
   * which provider is calling. The turboquant extension already writes
   * GGUFs here; the upstream extension reads/writes the same tree so that
   * a single download serves both engines. Backend binaries and provider
   * config remain isolated per-provider under `<jan>/<providerId>/`.
   */
  async getModelsRootPath(): Promise<string> {
    return await joinPath([
      await getJanDataFolderPath(),
      MODELS_PROVIDER_ROOT,
      'models',
    ])
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
    const previousVersionBackend =
      key === 'version_backend'
        ? stripBom(this.config.version_backend || '')
        : undefined
    this.config[key] = value

    if (key === 'version_backend') {
      const valueStr = value as string
      // Async logic wrapped in IIFE since onSettingUpdate is void
      ;(async () => {
        try {
          // "Latest <variant>" dropdown entries carry a `latest/<backend>`
          // sentinel (they are listed statically, even offline). Resolve the
          // sentinel to the newest concrete release tag now, then route
          // through updateBackend() so the resolved tag is downloaded,
          // persisted, and reflected back into the dropdown selection.
          if (valueStr.startsWith('latest/')) {
            const backendId = valueStr.slice('latest/'.length).trim()
            const resolved = await this.resolveLatestBackendString(backendId)
            if (!resolved) {
              logger.error(
                `Could not resolve the latest release for '${backendId}' — the ggml-org release stream is unreachable. Backend left unchanged.`
              )
              this.config.version_backend = previousVersionBackend ?? ''
              return
            }
            await this.updateBackend(resolved)
            return
          }

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

  /**
   * Resolves a "Latest <variant>" sentinel backend id (e.g.
   * `win-cuda-13.3-x64`) to a concrete `<tag>/<backend>` string by looking
   * up the newest release tag from the ggml-org/llama.cpp release stream.
   * Returns `null` when the release stream is unreachable or the variant is
   * not present in the latest release assets.
   */
  private async resolveLatestBackendString(
    backend: string
  ): Promise<string | null> {
    try {
      const remote = await fetchRemoteBackends()
      const match = remote.find((b) => b.backend === backend)
      if (match?.version) {
        return `${match.version}/${backend}`
      }
      logger.warn(
        `[resolveLatestBackendString] '${backend}' not found in latest release assets`
      )
    } catch (err) {
      logger.warn(
        `[resolveLatestBackendString] Failed to fetch latest release for '${backend}': ${
          err instanceof Error ? err.message : err
        }`
      )
    }
    return null
  }

  /**
   * Returns the newest locally-installed version of a backend family
   * (e.g. `win-cuda-12.4-x64`) as a `<version>/<backend>` string, or `null`
   * when no version of that family is installed. Used as the offline
   * fallback for "Latest <variant>" selections when the ggml-org release
   * stream is unreachable / rate-limited — better to hot-swap to the newest
   * copy the user already has than to dead-end with an error.
   *
   * Version tags are ggml-org build numbers (`b9310`, `b9284`, …); we sort
   * by the trailing integer so `b9310` ranks above `b9284`.
   */
  /**
   * Resolves `p`, but never waits longer than `ms`. On timeout — or if `p`
   * rejects — resolves to `fallback`. Used to cap the ggml-org release lookup
   * in `downloadManualBackend()`: that lookup is routed through the Tauri
   * HTTP layer (reqwest), where a stalled TCP/TLS connection can outlive
   * `fetchRemoteBackends()`'s own JS `AbortController`, leaving the awaiting
   * promise pending forever. The dangling `p` is allowed to settle in the
   * background; we simply stop waiting on it.
   */
  private withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ])
  }

  private async newestInstalledOfFamily(
    backendId: string
  ): Promise<string | null> {
    try {
      const installed = await getLocalInstalledBackends()
      const sameFamily = installed.filter(
        (b) => stripBom(b.backend) === backendId
      )
      if (sameFamily.length === 0) return null
      const buildNumber = (v: string): number => {
        const m = /(\d+)/.exec(stripBom(v))
        return m ? parseInt(m[1], 10) : 0
      }
      sameFamily.sort((a, b) => buildNumber(b.version) - buildNumber(a.version))
      return `${stripBom(sameFamily[0].version)}/${backendId}`
    } catch (err) {
      logger.warn(`newestInstalledOfFamily('${backendId}') failed:`, err)
      return null
    }
  }

  /**
   * Drives a manual "Latest <variant>" dropdown selection (sentinel
   * `latest/<backend>`) through the same download → hot-swap → completed
   * dialog the "Find optimal backend" button uses — but triggered by hand.
   *
   * The whole flow is keyed on the sentinel string so the globally-mounted
   * `<BackendUpdater />` dialog (a separate `useBackendUpdater` instance) can
   * follow it via Tauri events alone:
   *   1. Emit `onManualBackendDownloading` immediately so the dialog opens in
   *      its spinning "downloading" state the instant the user picks a variant
   *      — no dead air while we resolve the release tag over the (sometimes
   *      slow) network.
   *   2. Resolve the concrete `<tag>/<backend>`: prefer the newest ggml-org
   *      release; if that stream is unreachable / rate-limited, fall back to
   *      the newest copy of this family already installed locally.
   *   3. Download only when the resolved target is NOT already installed —
   *      an already-installed pick just hot-swaps (no redundant fetch).
   *   4. `onBackendDownloadFinished` advances the dialog to "hot-swapping",
   *      then `applyBackendLive()` unloads running models, persists the
   *      resolved `version_backend` (emitting `settingsChanged` so the
   *      dropdown reflects the concrete tag), and dispatches
   *      `app:backend-hotswapped` which the dialog turns into its green
   *      "completed" state.
   *
   * Throws (after emitting `onManualBackendFailed` to dismiss the dialog)
   * when the target can be neither resolved online nor satisfied from a local
   * install, so the caller can surface a toast.
   */
  async downloadManualBackend(selection: string): Promise<void> {
    const sentinel = stripBom(selection)
    const isSentinel = sentinel.startsWith('latest/')
    const backendId = isSentinel
      ? sentinel.slice('latest/'.length).trim()
      : (sentinel.split('/')[1] || '').trim()
    const dialogKey = sentinel
    const label = friendlyBackendLabel(backendId)
    const current = stripBom(this.config.version_backend || '')

    // 1. Instant feedback: open the global recommendation dialog straight
    //    into its "downloading" spinner via a dedicated event the hook turns
    //    into `recommendation = payload` + `phase = 'downloading'` in a single
    //    handler. Going through `onBetterBackendDetected` + a separate
    //    `onBackendDownloadStarted` would race (the started handler reads a
    //    not-yet-committed `recommendation`) and leave the dialog stuck on
    //    the "recommend" confirm screen. The payload is keyed on the sentinel
    //    so the later finish / hot-swap events line up.
    if (events && typeof events.emit === 'function') {
      events.emit('onManualBackendDownloading', {
        currentBackend: current,
        recommendedBackend: dialogKey,
        recommendedCategory: label,
      })
    }

    try {
      // 2. Resolve a concrete <tag>/<backend>: ggml-org latest first, then
      //    fall back to the newest locally-installed copy of this family.
      //    fetchRemoteBackends() now bounds itself at ~15s (connectTimeout +
      //    AbortController) and routes through the configured proxy, so this
      //    outer cap is only a last-resort safety net against a wedged
      //    promise. It MUST sit comfortably above that 15s budget — an 8s cap
      //    here would preempt a slow-but-valid proxied lookup and force
      //    backends with no local copy (e.g. win-vulkan-x64) to dead-end even
      //    though GitHub would have answered in time.
      const MANUAL_RESOLVE_TIMEOUT_MS = 20000
      let concrete: string | null = null
      if (isSentinel) {
        concrete = await this.withTimeout(
          this.resolveLatestBackendString(backendId),
          MANUAL_RESOLVE_TIMEOUT_MS,
          null
        )
        if (!concrete) {
          concrete = await this.newestInstalledOfFamily(backendId)
          if (concrete) {
            logger.warn(
              `downloadManualBackend: ggml-org unreachable/slow for '${backendId}', falling back to newest installed ${concrete}`
            )
          }
        }
      } else {
        concrete = sentinel
      }

      if (!concrete) {
        throw new Error(
          `Could not resolve a release for '${backendId}': the ggml-org release stream is unreachable and no version of this backend is installed locally.`
        )
      }

      // 3. Download only if the resolved target isn't already on disk.
      const [tag, btype] = concrete.split('/')
      const alreadyInstalled = await isBackendInstalled(btype, tag)
      if (alreadyInstalled) {
        logger.info(
          `downloadManualBackend: ${concrete} already installed — switching without download`
        )
      } else {
        logger.info(`downloadManualBackend: downloading ${concrete}`)
        await this.downloadAndInstallBackend(concrete)
      }

      // 4. Advance the dialog to "hot-swapping" (no-op if the inner
      //    download already emitted a concrete finish that moved us there).
      if (events && typeof events.emit === 'function') {
        events.emit(AppEvent.onBackendDownloadFinished, {
          backend: dialogKey,
          status: 'completed',
        })
      }

      // 5. Live hot-swap: unload models, persist version_backend (emits
      //    settingsChanged → dropdown updates), dispatch app:backend-hotswapped
      //    (→ dialog "completed"). updateBackend()'s own ensureBackendReady()
      //    is a no-op here since the backend is now installed.
      await this.applyBackendLive(concrete)
      logger.info(`downloadManualBackend: applied ${concrete} live`)
    } catch (err) {
      logger.error('downloadManualBackend failed:', err)
      // Dismiss the dialog cleanly (back to idle) rather than dropping into
      // the "recommend" confirm screen a generic `failed` download event
      // would trigger. The caller surfaces the error toast.
      if (events && typeof events.emit === 'function') {
        events.emit('onManualBackendFailed', {
          backend: dialogKey,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    }
  }

  private async generateApiKey(modelId: string, port: string): Promise<string> {
    const hash = await invoke<string>('plugin:llamacpp-upstream|generate_api_key', {
      modelId: modelId + port,
      apiSecret: this.apiSecret,
    })
    return hash
  }

  override async get(modelId: string): Promise<modelInfo | undefined> {
    const modelPath = await joinPath([
      await this.getModelsRootPath(),
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
        await this.getModelsRootPath(),
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
    const modelsDir = await this.getModelsRootPath()
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
                await this.getModelsRootPath(),
                modelId,
                'model.yml',
              ])
              if (await fs.existsSync(configPath)) continue // Don't reimport

              // this is relative to Jan's data folder
              const modelDir = `${MODELS_PROVIDER_ROOT}/models/${modelId}`

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
      await this.getModelsRootPath(),
      modelId,
    ])
    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path: await joinPath([modelFolderPath, 'model.yml']),
    })
    const newFolderPath = await joinPath([
      await this.getModelsRootPath(),
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
            `${MODELS_PROVIDER_ROOT}/models/${modelId}`,
            `${MODELS_PROVIDER_ROOT}/models/${model.id}`
          ),
          mmproj_path: modelConfig?.mmproj_path?.replace(
            `${MODELS_PROVIDER_ROOT}/models/${modelId}`,
            `${MODELS_PROVIDER_ROOT}/models/${model.id}`
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
      await this.getModelsRootPath(),
      modelId,
      'model.yml',
    ])
    if (await fs.existsSync(configPath))
      throw new Error(`Model ${modelId} already exists`)

    // this is relative to Jan's data folder
    const modelDir = `${MODELS_PROVIDER_ROOT}/models/${modelId}`

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
   * Whether the given model id is a Gemma 4 MTP-capable target (31B / 26B-A4B).
   * Used by the provider settings UI to decide between the Gemma download path
   * and the Qwen built-in-MTP path / unsupported dialog.
   */
  async checkGemmaMtpSupport(modelId: string): Promise<boolean> {
    return checkGemmaMtpSupport(modelId)
  }

  /**
   * Ensure the Gemma 4 MTP draft head GGUF is present next to the target model
   * and recorded in its `model.yml` (`mtp_draft_path`). Mirrors the MLX
   * `ensureDraftDownloaded` flow: idempotent — if the head is already on disk
   * and referenced in `model.yml`, it is a no-op.
   *
   * @param modelId A Gemma 4 31B or 26B-A4B target model id.
   * @throws if the model id is not a Gemma 4 MTP target.
   */
  async ensureGemmaMtpDraft(modelId: string): Promise<void> {
    const draft: GemmaMtpDraft | null = resolveGemmaMtpDraft(modelId)
    if (!draft) {
      throw new Error(
        `Model "${modelId}" is not a Gemma 4 MTP-capable target (31B / 26B-A4B).`
      )
    }

    const janDataFolderPath = await getJanDataFolderPath()
    const modelsRoot = await this.getModelsRootPath()
    const configPath = await joinPath([modelsRoot, modelId, 'model.yml'])
    if (!(await fs.existsSync(configPath))) {
      throw new Error(`Model ${modelId} is not installed`)
    }

    // Path relative to Jan's data folder (kept relative in model.yml, matching
    // how `model_path` / `mmproj_path` are stored).
    const relativeDraftPath = `${MODELS_PROVIDER_ROOT}/models/${modelId}/mtp-draft.gguf`
    const absoluteDraftPath = await joinPath([
      janDataFolderPath,
      relativeDraftPath,
    ])

    const modelConfig = await invoke<ModelConfig>('read_yaml', {
      path: configPath,
    })

    // Already downloaded + referenced → nothing to do.
    if (
      modelConfig.mtp_draft_path === relativeDraftPath &&
      (await fs.existsSync(absoluteDraftPath))
    ) {
      return
    }

    if (!(await fs.existsSync(absoluteDraftPath))) {
      const downloadItem: DownloadItem = {
        url: gemmaMtpDraftUrl(draft),
        save_path: relativeDraftPath,
        proxy: getProxyConfig(),
        sha256: draft.draftSha256,
        size: draft.draftSize,
        model_id: modelId,
      }
      const onProgress = (transferred: number, total: number) => {
        events.emit(DownloadEvent.onFileDownloadUpdate, {
          modelId,
          percent: total > 0 ? transferred / total : 0,
          size: { transferred, total },
          downloadType: 'Model',
        })
      }
      const downloadManager = window.core.extensionManager.getByName(
        '@janhq/download-extension'
      )
      await downloadManager.downloadFiles(
        [downloadItem],
        this.createDownloadTaskId(`${modelId}-mtp-draft`),
        onProgress,
        false
      )
      events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
        modelId,
        downloadType: 'Model',
      })
    }

    // Record the head in model.yml so `performLoad` can resolve it.
    const updatedConfig = {
      ...modelConfig,
      mtp_draft_path: relativeDraftPath,
    } as ModelConfig
    await invoke<void>('write_yaml', {
      data: updatedConfig,
      savePath: configPath,
    })
  }

  /**
   * Deletes the entire model folder for a given modelId
   * @param modelId The model ID to delete
   */
  private async deleteModelFolder(modelId: string): Promise<void> {
    try {
      const modelDir = await joinPath([
        await this.getModelsRootPath(),
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
      const port = await invoke<number>('plugin:llamacpp-upstream|get_random_port')
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
      await this.getModelsRootPath(),
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

    // Gemma 4 MTP: the draft head is a separate GGUF keyed to the loaded
    // target, so resolve it lazily here rather than only at toggle time. If
    // MTP is enabled, this model is a Gemma 4 31B / 26B-A4B target, and the
    // head has not been downloaded/recorded yet (e.g. the user toggled MTP on
    // with no Gemma model active), fetch it now before building args. This
    // makes the single "Enable MTP" toggle robust regardless of which model
    // was active when it was flipped. Qwen-style built-in MTP carries no draft
    // path and is unaffected.
    if (cfg.mtp && !modelConfig.mtp_draft_path && checkGemmaMtpSupport(modelId)) {
      try {
        await this.ensureGemmaMtpDraft(modelId)
        const refreshed = await invoke<ModelConfig>('read_yaml', {
          path: modelConfigPath,
        })
        modelConfig.mtp_draft_path = refreshed.mtp_draft_path
      } catch (e) {
        logger.warn(
          `Failed to ensure Gemma MTP draft head for ${modelId}; loading without MTP:`,
          e
        )
      }
    }

    // When the head is present (`mtp_draft_path` in model.yml), resolve it to
    // an absolute path so the Rust arg builder can emit `--model-draft <path>`.
    if (cfg.mtp && modelConfig.mtp_draft_path) {
      cfg.mtp_draft_path = await joinPath([
        janDataFolderPath,
        modelConfig.mtp_draft_path,
      ])
    } else {
      cfg.mtp_draft_path = ''
    }

    if (!this.modelMaxCtxTrain.has(modelId)) {
      const max = await this.resolveModelMaxCtxTrain(modelPath)
      if (typeof max === 'number') {
        this.modelMaxCtxTrain.set(modelId, max)
      }
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
      // If the model crashed because its multimodal projector isn't supported
      // by the current backend (e.g. Gemma 4 `gemma4a` audio projector on a
      // libmtmd build that lacks its graph builder), retry once text-only by
      // dropping --mmproj. This keeps the model usable instead of failing the
      // whole load with an opaque error. See issue #44.
      const code = (error as { code?: string } | undefined)?.code
      if (
        mmprojPath &&
        code === ERR_MULTIMODAL_PROJECTOR_LOAD_FAILED
      ) {
        logger.warn(
          `Model "${modelId}" has an unsupported multimodal projector for backend "${backend}". Retrying text-only (without --mmproj).`
        )
        try {
          const sInfo = await loadLlamaModel(
            backendPath,
            modelId,
            modelPath,
            port,
            cfg,
            envs,
            undefined, // text-only: drop the unsupported mmproj
            isEmbedding,
            Number(this.timeout)
          )
          this.sessionCache.set(modelId, sInfo)
          if (typeof cfg.ctx_size === 'number') {
            this.modelCtxSize.set(modelId, cfg.ctx_size)
          }
          try {
            await tauriEmit(MULTIMODAL_DISABLED_FALLBACK, { modelId })
          } catch (emitErr) {
            logger.warn(
              `Failed to emit multimodal fallback notice for "${modelId}": ${emitErr}`
            )
          }
          return sInfo
        } catch (retryError) {
          logger.error(
            'Text-only retry after unsupported projector also failed:\n',
            retryError
          )
          throw retryError
        }
      }
      logger.error('Error in load command:\n', error)
      throw error
    }
  }

  /// Read `{general.architecture}.context_length` from a GGUF file. Returns
  /// `undefined` (with a warning logged) if the file is unreadable or the
  /// key is missing — callers must treat the absence of a bound as "no
  /// hard cap known" and fall back to the open-ended ladder.
  private async resolveModelMaxCtxTrain(
    modelPath: string
  ): Promise<number | undefined> {
    try {
      const metadata = await readGgufMetadata(modelPath)
      const arch = metadata.metadata?.['general.architecture']
      if (typeof arch !== 'string' || !arch) return undefined
      const raw = metadata.metadata?.[`${arch}.context_length`]
      const parsed =
        typeof raw === 'number'
          ? raw
          : raw != null
            ? parseInt(String(raw), 10)
            : NaN
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    } catch (e) {
      logger.warn(
        `Failed to resolve max ctx_train from GGUF at ${modelPath}: ${e}`
      )
      return undefined
    }
  }

  /// Public lookup used by the web-app UI (via duck-typed engine call) so
  /// the in-app "Increase Context" path can clamp at the model's true
  /// training-max ctx and avoid an infinite regenerate→error→bump cycle.
  /// Resolves the value lazily from GGUF metadata on first request and
  /// caches it in-memory for the lifetime of the extension.
  async getMaxCtxTrain(modelId: string): Promise<number | undefined> {
    const cached = this.modelMaxCtxTrain.get(modelId)
    if (typeof cached === 'number') return cached
    try {
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
      const modelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])
      const max = await this.resolveModelMaxCtxTrain(modelPath)
      if (typeof max === 'number') {
        this.modelMaxCtxTrain.set(modelId, max)
      }
      return max
    } catch (e) {
      logger.warn(`getMaxCtxTrain failed for ${modelId}: ${e}`)
      return undefined
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
      const maxCtxLen = this.modelMaxCtxTrain.get(model_id)
      const newCtxLen = computeNextCtxLen(currentCtxLen, maxCtxLen)

      if (newCtxLen <= currentCtxLen) {
        await sendDone({ ok: false, reason: 'at_max' })
        try {
          await tauriEmit(AUTO_INCREASE_CTX_AT_MAX, {
            provider: this.provider,
            modelId: model_id,
            maxCtxLen: maxCtxLen ?? currentCtxLen,
            currentCtxLen,
          })
        } catch (e) {
          logger.warn(`Failed to Tauri-emit ${AUTO_INCREASE_CTX_AT_MAX}: ${e}`)
        }
        logger.info(
          `auto_increase_ctx (llamacpp-upstream) at_max model=${model_id} currentCtxLen=${currentCtxLen} maxCtxLen=${maxCtxLen ?? 'unknown'}`
        )
        return
      }

      logger.info(
        `auto_increase_ctx (llamacpp-upstream) model=${model_id} trigger=${trigger} ${currentCtxLen} -> ${newCtxLen} (max=${maxCtxLen ?? 'unknown'})`
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

  /**
   * Sanitize a taskId so the downstream `download-extension` (which wraps
   * it in `download-${taskId}` and feeds it to Tauri's `listen()`) does
   * not get rejected by Tauri's event-name validator. Tauri restricts
   * event names to `[A-Za-z0-9_/:-]`. ggml-org Windows backends contain
   * `.` (`win-cuda-12.4-x64`, `win-cuda-13.3-x64`), so we must strip dots
   * out of the backend / version portion before constructing a taskId.
   *
   * The taskId is opaque to downstream consumers — nothing parses it
   * back into `version` / `backend`, so collapsing `.` to `_` is safe.
   * Other forbidden characters get the same treatment for defense in
   * depth.
   */
  private sanitizeForTauriEvent(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
  }

  private async ensureBackendReady(
    backend: string,
    version: string
  ): Promise<void> {
    backend = stripBom(backend)
    version = stripBom(version)
    const backendKey = `${version}/${backend}`
    if (await isBackendInstalled(backend, version)) {
      // Backend exe is present, but on Windows CUDA variants the cudart
      // runtime DLLs may still be missing (e.g. for users that installed
      // a backend through an older build, or for the bundled CPU build
      // which carries no cudart). Patch them in place idempotently
      // without re-downloading the full backend archive.
      if (IS_WINDOWS) {
        const targetDir = await getBackendDir(backend, version)
        try {
          await this.ensureCudartReady(version, backend, targetDir, backendKey)
        } catch (cudartErr) {
          logger.warn(
            `cudart pre-flight for ${backendKey} failed: ${
              cudartErr instanceof Error ? cudartErr.message : String(cudartErr)
            }`
          )
        }
      }
      return
    }

    // Both bundled (re-codesigned macOS / GPU-detected Windows) and
    // runtime-downloaded backends come from the same ggml-org/llama.cpp
    // release stream, so attempting a download is valid on every
    // platform served by this extension.
    logger.info(
      `Backend ${backendKey} not installed locally, attempting download from upstream releases...`
    )
    try {
      await this.downloadAndInstallBackend(backendKey)
    } catch (err) {
      logger.error(`Failed to download backend ${backendKey}:`, err)
    }

    if (await isBackendInstalled(backend, version)) {
      return
    }

    throw new Error(
      `Backend ${backendKey} is not installed and could not be downloaded. Check your internet connection or try reinstalling the app.`
    )
  }

  /**
   * Downloads a backend archive from ggml-org/llama.cpp GitHub releases
   * and extracts it into the local backends directory.
   *
   * ggml-org publishes Windows and macOS backends as `.zip` archives
   * (not `.tar.gz`). The Tauri `decompress` command handles both formats,
   * so the extension change here is transparent to the extraction path.
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

    // Defense-in-depth (ATO-95): a `latest` tag is an unresolved sentinel —
    // ggml-org has no `latest` release tag, so building a download URL with
    // it always 404s. Callers must resolve the sentinel to a concrete
    // `<tag>/<backend>` (via `resolveLatestBackendString`) before reaching
    // here.
    if (version === 'latest') {
      throw new Error(
        `downloadAndInstallBackend: refusing to download unresolved 'latest' tag for '${backend}'. Resolve the latest/<backend> sentinel to a concrete release tag first.`
      )
    }

    if (await isBackendInstalled(backend, version)) {
      logger.info(
        `Backend ${backendString} is already installed, skipping download`
      )
      return
    }

    const url = getBackendDownloadUrl(version, backend)
    const janDataFolderPath = await getJanDataFolderPath()
    // Temp staging shares the upstream root with the rest of the
    // extension's on-disk state (`llamacpp-upstream/tmp`) so partial
    // downloads can't leak into the turboquant provider's tree.
    const tempDir = await joinPath([janDataFolderPath, 'llamacpp-upstream', 'tmp'])
    if (!(await fs.existsSync(tempDir))) {
      await fs.mkdir(tempDir)
    }
    const archiveName = `llama-${version}-bin-${backend}.zip`
    const archivePath = await joinPath([tempDir, archiveName])
    const targetDir = await getBackendDir(backend, version)

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
    //
    // Sanitize `version`/`backend` separately because both can now
    // carry dots after the ggml-org switch (e.g. `win-cuda-13.3-x64`),
    // and Tauri's `listen()` — invoked under the hood by
    // `download-extension` with `download-${taskId}` — rejects dots.
    //
    // IMPORTANT: declared outside the try block so the catch / finally
    // can reference it. A previous version had this inside `try {`
    // which produced a `ReferenceError: taskId is not defined` when
    // any sub-operation (extract / relocate / install verification)
    // failed and the catch block tried to emit a cleanup event.
    const taskId = `llamacpp-backend-${this.sanitizeForTauriEvent(
      version
    )}/${this.sanitizeForTauriEvent(backend)}`

    logger.info(`Downloading backend ${backendString} from ${url}`)

    if (events && typeof events.emit === 'function') {
      events.emit(AppEvent.onBackendDownloadStarted, {
        backend: backendString,
        status: 'downloading',
      })
    }

    try {
      const downloadManager = window.core?.extensionManager?.getByName(
        '@janhq/download-extension'
      ) as
        | {
            downloadFiles?: (
              items: DownloadItem[],
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

      // Route through the configured HTTPS proxy (Settings → Proxy) just
      // like model downloads do. Without this, users behind a proxy /
      // in GitHub-restricted networks get a raw TCP timeout (os error
      // 10060) because the backend archive request bypasses the proxy.
      const proxy = getProxyConfig() ?? undefined

      if (downloadManager?.downloadFiles) {
        await downloadManager.downloadFiles(
          [{ url, save_path: archivePath, proxy }],
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
          items: [{ url, save_path: archivePath, proxy }],
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
          // ggml-org Windows zips extract with a flat layout
          // (llama-server.exe + DLLs at the archive root), while the
          // janhq turboquant tarballs already contain `build/bin/`.
          // Move (not copy) each top-level entry into `build/bin/`
          // so layouts converge. `fs.mv` is the only file-relocation
          // primitive currently exposed by the Tauri shell — there is
          // no `copy_file` command on the Rust side, and trying to
          // use `fs.copyFile` here throws "Command copy_file not
          // found" on Windows.
          //
          // CAREFUL: the Tauri `readdir_sync` command returns FULL
          // absolute paths (Rust's `entry.path().to_string_lossy()`),
          // not basenames. Treating them as basenames here previously
          // produced a silent loop where `joinPath([targetDir, fullPath])`
          // resolved to `fullPath` itself (Path::join replaces the
          // base when the second arg is absolute), giving `mv(x, x)`
          // — every iteration was a no-op and the final
          // `isBackendInstalled` check rightly failed with
          // "llama-server binary not found at expected path". Strip
          // to the basename before joining and before the `build`
          // skip check.
          logger.info('Relocating flat-extracted binaries into build/bin/')
          const buildBinDir = await joinPath([targetDir, 'build', 'bin'])
          await fs.mkdir(buildBinDir)
          const entries = (await fs.readdirSync(targetDir)) as string[]
          for (const rawEntry of entries) {
            const baseName = rawEntry.split(/[/\\]/).filter(Boolean).pop()
            if (!baseName || baseName === 'build') continue
            const src = await joinPath([targetDir, baseName])
            const dst = await joinPath([buildBinDir, baseName])
            await fs.mv(src, dst)
          }
        }
      }

      if (!(await isBackendInstalled(backend, version))) {
        throw new Error(
          `Backend extracted but llama-server binary not found at expected path`
        )
      }

      // Windows CUDA backends ship without the CUDA Toolkit runtime DLLs;
      // those live in a sibling `cudart-llama-bin-win-cuda-{X.Y}-x64.zip`
      // archive on the same ggml-org release. Merge them into build/bin/
      // here so that `llama-server.exe --list-devices` can enumerate GPUs
      // on machines without a system-wide CUDA Toolkit install
      // (AtomicBot-ai/Atomic-Chat#14).
      if (IS_WINDOWS) {
        try {
          await this.ensureCudartReady(version, backend, targetDir, backendString)
        } catch (cudartErr) {
          // Do not fail the whole install — the backend exe is in place,
          // it's just GPU enumeration that will be missing. Surface a
          // warning so the user sees what happened in logs.
          logger.warn(
            `Backend ${backendString} installed, but cudart DLL merge failed: ${
              cudartErr instanceof Error ? cudartErr.message : String(cudartErr)
            }`
          )
        }
      }

      logger.info(`Backend ${backendString} installed successfully`)

      if (events && typeof events.emit === 'function') {
        // Clear from the standard download manager UI.
        // Use the same sanitized taskId the progress events were emitted
        // with — the download manager UI keys rows by `modelId`, and an
        // unsanitized id would create a phantom row that never clears.
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
          modelId: taskId,
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
        // Same modelId rule as the success path above.
        events.emit(DownloadEvent.onFileDownloadError, {
          modelId: taskId,
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

  /**
   * Downloads the matching `cudart-llama-bin-win-cuda-{X.Y}-x64.zip` for a
   * Windows CUDA backend variant and copies every `*.dll` it contains into
   * `<targetDir>/build/bin/`.
   *
   * No-op (returns immediately) when:
   *   - `backend` is not a Windows CUDA backend (`win-cuda-{12.4,13.3}-x64`)
   *   - cudart DLLs are already present (checked via the Rust
   *     `plugin:llamacpp-upstream|is_cuda_installed` command, which also
   *     handles a legacy `<jan>/llamacpp/lib/` -> `build/bin/` migration).
   *
   * Idempotent — safe to call from both the post-extract path inside
   * `downloadAndInstallBackend` and the pre-flight inside
   * `ensureBackendReady`.
   */
  private async ensureCudartReady(
    version: string,
    backend: string,
    targetDir: string,
    backendString: string
  ): Promise<void> {
    if (!IS_WINDOWS) return

    const cudartUrl = getCudartDownloadUrl(version, backend)
    const cudartName = getCudartArchiveName(backend)
    const toolkitVersion = getCudaToolkitVersion(backend)
    if (!cudartUrl || !cudartName || !toolkitVersion) {
      return
    }

    const janDataFolderPath = await getJanDataFolderPath()

    try {
      const alreadyInstalled = await isCudaInstalledFromRust(
        targetDir,
        toolkitVersion,
        'windows',
        janDataFolderPath
      )
      if (alreadyInstalled) {
        logger.info(
          `cudart for ${backendString} already present, skipping download`
        )
        return
      }
    } catch (probeErr) {
      logger.warn(
        `is_cuda_installed probe failed for ${backendString}, will attempt cudart download anyway: ${
          probeErr instanceof Error ? probeErr.message : String(probeErr)
        }`
      )
    }

    const tempDir = await joinPath([janDataFolderPath, 'llamacpp-upstream', 'tmp'])
    if (!(await fs.existsSync(tempDir))) {
      await fs.mkdir(tempDir)
    }
    const cudartArchivePath = await joinPath([tempDir, cudartName])
    const cudartExtractDir = await joinPath([
      tempDir,
      `cudart-${backend}-${version}`,
    ])

    logger.info(
      `Downloading cudart for ${backendString} from ${cudartUrl}`
    )

    // Same Tauri event-name sanitization as the backend download path —
    // ggml-org CUDA backends carry dots (e.g. `win-cuda-13.3-x64`) which
    // `listen('download-${taskId}', …)` in `download-extension` rejects
    // with "Event name must include only alphanumeric characters, …".
    const taskId = `llamacpp-cudart-${this.sanitizeForTauriEvent(
      version
    )}/${this.sanitizeForTauriEvent(backend)}`
    const downloadManager = window.core?.extensionManager?.getByName(
      '@janhq/download-extension'
    ) as
      | {
          downloadFiles?: (
            items: DownloadItem[],
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

    // Honor the configured HTTPS proxy for the cudart DLL fetch too,
    // mirroring the main backend archive download.
    const proxy = getProxyConfig() ?? undefined

    try {
      if (downloadManager?.downloadFiles) {
        await downloadManager.downloadFiles(
          [{ url: cudartUrl, save_path: cudartArchivePath, proxy }],
          taskId,
          onProgress,
          false
        )
      } else {
        logger.warn(
          'download-extension not available, falling back to raw download_files invoke for cudart'
        )
        await invoke<void>('download_files', {
          items: [{ url: cudartUrl, save_path: cudartArchivePath, proxy }],
          taskId,
          headers: {},
          resume: false,
        })
      }

      if (!(await fs.existsSync(cudartExtractDir))) {
        await fs.mkdir(cudartExtractDir)
      }

      logger.info(`Extracting cudart archive to ${cudartExtractDir}`)
      await invoke('decompress', {
        path: cudartArchivePath,
        outputDir: cudartExtractDir,
      })

      const buildBinDir = await joinPath([targetDir, 'build', 'bin'])
      if (!(await fs.existsSync(buildBinDir))) {
        await fs.mkdir(buildBinDir)
      }

      // Recursively walk every entry under `cudartExtractDir` and move
      // each *.dll into build/bin/. Most ggml-org cudart archives are
      // flat (DLLs at the root), but we walk just in case a future
      // build introduces a subfolder.
      //
      // The Tauri `readdir_sync` command returns FULL absolute paths
      // (Rust's `entry.path().to_string_lossy()`), so:
      //   - `entry` IS already the full path; no `joinPath` rebuild.
      //   - `joinPath([buildBinDir, entry])` would resolve to `entry`
      //     itself (Path::join replaces the base when the second arg
      //     is absolute), giving `mv(x, x)` and silently dropping
      //     every DLL move. Always derive the basename via splitting
      //     on path separators before composing the destination.
      let copied = 0
      const stack: string[] = [cudartExtractDir]
      while (stack.length > 0) {
        const currentDir = stack.pop() as string
        const entries = (await fs.readdirSync(currentDir)) as string[]
        for (const entryPath of entries) {
          let stat: { isDirectory?: boolean } | undefined
          try {
            stat = await fs.fileStat(entryPath)
          } catch {
            stat = undefined
          }
          if (stat?.isDirectory) {
            stack.push(entryPath)
            continue
          }
          const baseName = entryPath.split(/[/\\]/).filter(Boolean).pop()
          if (!baseName) continue
          if (baseName.toLowerCase().endsWith('.dll')) {
            const dst = await joinPath([buildBinDir, baseName])
            // `fs.mv` is the only file relocation primitive exposed by
            // the Tauri shell — `fs.copyFile` resolves to a missing
            // `copy_file` Rust command. Moving (not copying) is fine
            // here: the entire `cudartExtractDir` gets removed in the
            // `finally` block below, so we'd lose the source either
            // way.
            await fs.mv(entryPath, dst)
            copied += 1
          }
        }
      }

      logger.info(
        `Merged ${copied} cudart DLL(s) into ${buildBinDir} for ${backendString}`
      )

      if (copied === 0) {
        throw new Error(
          `cudart archive for ${backendString} contained no DLLs`
        )
      }

      // Clear the cudart row from the top-left download manager UI.
      // Without this, the per-chunk `onProgress` emits above leave a
      // phantom row stuck at 100% forever — the backend tarball clears
      // itself via the matching success emit in
      // `downloadAndInstallBackend`, but the cudart taskId is distinct
      // and previously had no clear path of its own.
      if (events && typeof events.emit === 'function') {
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
          modelId: taskId,
          downloadType: 'Backend',
        })
      }
    } catch (cudartErr) {
      // Mirror the success path so the UI row gets cleared even when
      // the cudart merge fails. The caller in `downloadAndInstallBackend`
      // swallows this error as best-effort (the backend exe is in place;
      // only GPU enumeration is missing) and `ensureBackendReady` wraps
      // it similarly — neither layer would otherwise dispatch a clear
      // event for `taskId`.
      if (events && typeof events.emit === 'function') {
        events.emit(DownloadEvent.onFileDownloadError, {
          modelId: taskId,
          error:
            cudartErr instanceof Error ? cudartErr.message : String(cudartErr),
          downloadType: 'Backend',
        })
      }
      throw cudartErr
    } finally {
      try {
        if (await fs.existsSync(cudartArchivePath)) {
          await fs.rm(cudartArchivePath)
        }
      } catch {
        // best-effort cleanup
      }
      try {
        if (await fs.existsSync(cudartExtractDir)) {
          await fs.rm(cudartExtractDir)
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
        'plugin:llamacpp-upstream|find_session_by_model',
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
    const result = await invoke<boolean>('plugin:llamacpp-upstream|is_process_running', {
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
      await this.getModelsRootPath(),
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
        'plugin:llamacpp-upstream|get_loaded_models'
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
        await this.getModelsRootPath(),
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
        await this.getModelsRootPath(),
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
      const dList = await invoke<DeviceList[]>('plugin:llamacpp-upstream|get_devices', {
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
      await this.getModelsRootPath(),
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

  private sanitizeMessagesForApplyTemplate(
    messages: chatCompletionRequestMessage[]
  ): chatCompletionRequestMessage[] {
    return messages.filter((msg) => {
      if (!msg?.role) return false
      if (typeof msg.content === 'string') {
        return msg.content.trim().length > 0
      }
      if (Array.isArray(msg.content)) {
        return msg.content.length > 0
      }
      return false
    })
  }

  async getTokensCount(opts: chatCompletionRequest): Promise<number> {
    if (!opts.messages || opts.messages.length === 0) {
      return 0
    }

    const messagesForTemplate = this.sanitizeMessagesForApplyTemplate(
      opts.messages
    )
    if (messagesForTemplate.length === 0) {
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
      messages: messagesForTemplate,
      tools: [],
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
