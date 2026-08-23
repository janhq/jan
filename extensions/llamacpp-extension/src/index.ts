/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module llamacpp-extension/src/index
 */

import {
  AIEngine,
  type EmbeddingEngine,
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
  SettingComponentProps,
  DropdownComponentProps,
  logger,
} from '@janhq/core'
import {
  readSettingsFile,
  writeSettingsFile,
  settingsFileExists,
} from './settings-store'

import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  getProxyConfig,
  buildEmbedBatches,
  mergeEmbedResponses,
  detectEmbeddingFromGgufMeta,
  detectMtpLayersFromGgufMeta,
  detectTemplateKwargsFromChatTemplate,
  getDefaultEmbeddingModelId,
  setDefaultEmbeddingModelId,
  type EmbedBatchResult,
} from './util'
import {
  generatePreset,
  DEFAULT_EMBEDDING_UBATCH,
  MTP_MIN_BUILD,
} from './preset'
import {
  evaluateEmbeddingVector,
  evaluateGpuOffload,
  backendFromDeviceIds,
  type EmbeddingVectorProblem,
  type GpuOffloadCheck,
  type ReadinessStatus,
} from './readiness'
import {
  getBackendSetting,
  setBackendSetting,
  removeBackendSetting,
} from './backend-settings'
import { basename } from '@tauri-apps/api/path'
import {
  asI32,
  loadLlamaModel,
  readGgufMetadata,
  isModelSupported,
  unloadLlamaModel,
  startEngine,
  getEngineInfo as pluginGetEngineInfo,
  reloadEngineModels,
  engineDevices,
  generateApiKey as pluginGenerateApiKey,
  findSessionByModel as pluginFindSessionByModel,
  ensureSessionReady as pluginEnsureSessionReady,
  getLoadedModels as pluginGetLoadedModels,
  LlamacppConfig,
  DownloadItem,
  ModelConfig,
  TemplateKwarg,
  EmbeddingResponse,
  ModelProps,
  DeviceList,
} from '@janhq/tauri-plugin-llamacpp-api'
import { getSystemUsage, getSystemInfo } from '@janhq/tauri-plugin-hardware-api'

const EMBEDDING_CHECK_VERSION = 3
const MTP_CHECK_VERSION = 1
const TEMPLATE_KWARGS_CHECK_VERSION = 1

// Provider settings that end up in `router.preset.ini` (`[*]` global section
// in preset.ts). Mutating any of these needs the preset reloaded so the new
// value is read; cosmetic / process-only keys (models_max, timeout,
// llamacpp_env) are handled separately or not at all.
const PRESET_AFFECTING_KEYS = new Set<string>([
  'fit',
  'fit_target',
  'fit_ctx',
  'flash_attn',
  'cache_type_k',
  'cache_type_v',
  'parallel',
  'cont_batching',
  'threads',
  'threads_batch',
  'n_predict',
  'batch_size',
  'ubatch_size',
  'n_cpu_moe',
  'no_kv_offload',
  'device',
  'split_mode',
  'main_gpu',
  'no_mmap',
  'mlock',
  'rope_scaling',
  'rope_freq_base',
  'rope_freq_scale',
  'ctx_shift',
  'cache_ram',
  'cache_reuse',
  'swa_full',
  'keep',
  'kv_unified',
  'tensor_split',
  'no_op_offload',
  'ctx_checkpoints',
  'checkpoint_min_step',
])


/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */

type YamlSettingValue = string | number | boolean | null

type PersistedProviderSetting = {
  controller_props?: {
    value?: unknown
  }
}

type PersistedModelState = {
  id?: unknown
  settings?: Record<string, PersistedProviderSetting>
}

const MODEL_PROVIDER_STORE_KEY = 'model-provider'
const INTERFACE_SETTINGS_STORE_KEY = 'setting-appearance'
const EMBEDDER_BOOTSTRAP_KEY = 'llamacpp-embedder-bootstrapped'
/** Set once the user has agreed to the first-run download. */
const SETUP_CONSENT_KEY = 'llamacpp-first-run-setup-started'
const FALLBACK_EMBEDDING_MODEL_ID = 'sentence-transformer-mini'
const FALLBACK_EMBEDDING_MODEL_URL =
  'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf?download=true'
const LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY =
  'llamacpp_model_yaml_backfill_v2'

/// The GPU-layers value the old UI shipped as its default. v1 of the backfill
/// copied it into every model.yml, which pins offload to 100 layers and defeats
/// llama.cpp's own -1 (auto, VRAM-aware) -- an OOM on a small GPU. v2 removes it
/// again. A user who deliberately chose exactly 100 loses that choice, which is
/// the right trade: 100 was never a considered value, it was the default.
const LEGACY_NGL_DEFAULT = 100

/// Matches the `timeout` default in settings.json.
const DEFAULT_TIMEOUT = 600

// Short and non-empty: enough to exercise tokenize plus pooling without making
// setup wait on a long prompt.
const EMBEDDING_PROBE_TEXT = 'jan setup embedding probe'

export interface EmbeddingModelReport {
  status: ReadinessStatus
  modelId?: string
  dimension?: number
  problem?: EmbeddingVectorProblem
  error?: string
  /** The engine has not finished setting up, so nothing was concluded. */
  pending?: boolean
}

export interface GpuOffloadReport extends GpuOffloadCheck {
  backend: string
  /** Set when the device probe itself failed, leaving `reason` undetermined. */
  error?: string
  /** The engine has not finished setting up, so nothing was concluded. */
  pending?: boolean
}

// Sampling defaults are floats/ints where 0 is a meaningful value (e.g.
// temperature=0), so unlike ctx_len these coercions keep 0 and only reject
// blank/non-finite input.
const coerceFloatSetting = (v: unknown): YamlSettingValue => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const coerceIntSetting = (v: unknown): YamlSettingValue => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

const MODEL_SETTINGS_YAML_MAPPING: Record<
  string,
  {
    yamlKey: string
    coerce: (v: unknown) => YamlSettingValue
  }
> = {
  // Sampling defaults: persisted to model.yml and emitted into the router
  // preset so they apply server-side to every request (chat and external API),
  // overridable per-request. Keys mirror MODEL_SAMPLING_SETTING_KEYS in the
  // web-app transport.
  temperature: { yamlKey: 'temperature', coerce: coerceFloatSetting },
  top_k: { yamlKey: 'top_k', coerce: coerceIntSetting },
  top_p: { yamlKey: 'top_p', coerce: coerceFloatSetting },
  min_p: { yamlKey: 'min_p', coerce: coerceFloatSetting },
  // Not coerceIntSetting: upstream throws on a negative window on both the
  // preset path and the per-request path, so a legacy -1 from the old
  // "-1 = full context" UI has to be dropped, not passed through. Omitting the
  // key lets upstream's own default (64) apply.
  repeat_last_n: {
    yamlKey: 'repeat_last_n',
    coerce: (v) => {
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
    },
  },
  repeat_penalty: { yamlKey: 'repeat_penalty', coerce: coerceFloatSetting },
  presence_penalty: { yamlKey: 'presence_penalty', coerce: coerceFloatSetting },
  frequency_penalty: {
    yamlKey: 'frequency_penalty',
    coerce: coerceFloatSetting,
  },
  ctx_len: {
    yamlKey: 'ctx_size',
    coerce: (v) => {
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    },
  },
  ngl: {
    yamlKey: 'n_gpu_layers',
    coerce: (v) => {
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : Number(v)
      // -1 is auto (VRAM-aware) and -2 or below means all layers, so the floor
      // is -2 rather than 0.
      return Number.isFinite(n) && n >= -2 ? Math.floor(n) : null
    },
  },
  chat_template: {
    yamlKey: 'chat_template',
    coerce: (v) =>
      typeof v === 'string' && v.trim().length > 0 ? v : null,
  },
  batch_size: {
    yamlKey: 'batch_size',
    coerce: (v) => {
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    },
  },
  ubatch_size: {
    yamlKey: 'ubatch_size',
    coerce: (v) => {
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    },
  },
  cpu_moe: {
    yamlKey: 'cpu_moe',
    coerce: (v) => (v === true ? true : null),
  },
  n_cpu_moe: {
    yamlKey: 'n_cpu_moe',
    coerce: (v) => {
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    },
  },
  no_kv_offload: {
    yamlKey: 'no_kv_offload',
    coerce: (v) => (v === true ? true : null),
  },
  override_tensor_buffer_t: {
    yamlKey: 'override_tensor',
    coerce: (v) =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : null,
  },
  offload_mmproj: {
    yamlKey: 'mmproj_offload',
    coerce: (v) => (v === false ? false : null),
  },
}

async function readPersistedLlamacppModels(): Promise<PersistedModelState[]> {
  try {
    const raw = await getBackendSetting(MODEL_PROVIDER_STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const providers = parsed?.state?.providers
    if (!Array.isArray(providers)) return []
    const llamacpp = providers.find(
      (provider: { provider?: unknown }) => provider?.provider === 'llamacpp'
    )
    return Array.isArray(llamacpp?.models) ? llamacpp.models : []
  } catch (error) {
    logger.warn('Failed to read persisted llamacpp model settings:', error)
    return []
  }
}

// Interface settings persist to the Rust settings store (settings.json), not
// webview localStorage — see web-app/src/lib/backendStorage.ts. The value is
// the Zustand-persisted blob `{ state: {...} }`. Defaults to true (feature on).
async function readAutoGenerateTitleSetting(): Promise<boolean> {
  try {
    const raw = await getBackendSetting(INTERFACE_SETTINGS_STORE_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw)
    const value = parsed?.state?.autoGenerateTitle
    return typeof value === 'boolean' ? value : true
  } catch (error) {
    logger.warn('Failed to read autoGenerateTitle setting:', error)
    return true
  }
}

/**
 * Breadth-first search of `rootDir` for the directory directly containing
 * a file named `serverName`. Returns the absolute path of that directory,
 * or null if not found. Used by manual backend install to tolerate
 * different archive layouts (Jan-built `build/bin/...` vs upstream
 * llama.cpp's flat `llama-bXXXX/...`).
 */
async function findLlamaServerDir(
  rootDir: string,
  serverName: string
): Promise<string | null> {
  // Note: fs.readdirSync returns absolute child paths (see
  // src-tauri/src/core/filesystem/commands.rs::readdir_sync), not basenames.
  const queue: string[] = [rootDir]
  while (queue.length > 0) {
    const current = queue.shift() as string
    let entries: string[]
    try {
      entries = await fs.readdirSync(current)
    } catch {
      continue
    }
    for (const entryPath of entries) {
      let stat
      try {
        stat = await fs.fileStat(entryPath)
      } catch {
        continue
      }
      if (!stat) continue
      const entryName = await basename(entryPath)
      if (!stat.isDirectory && entryName === serverName) {
        return current
      }
      if (stat.isDirectory) {
        queue.push(entryPath)
      }
    }
  }
  return null
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

export default class llamacpp_extension extends AIEngine implements EmbeddingEngine {
  provider: string = 'llamacpp'
  timeout: number = 600
  llamacpp_env: string = ''
  readonly providerId: string = 'llamacpp'

  private config: LlamacppConfig
  private providerPath!: string
  private apiSecret: string = 'JustAskNow'
  private pendingDownloads: Map<string, Promise<void>> = new Map()
  /** Keyed by modelId; two imports of one model would cancel each other. */
  private pendingImports: Map<string, Promise<void>> = new Map()
  private embedderBootstrapError?: string
  /**
   * True while the fallback embedder is being fetched.
   *
   * The old readiness gate keyed off "no backend selected yet", which happened
   * to cover this window on a fresh install. The engine ships with the app now,
   * so that proxy is gone and this is the direct signal -- without it, a normal
   * first-run download is reported as a failed embedding check.
   */
  private embedderBootstrapping = false
  private loadingModels = new Map<string, Promise<SessionInfo>>() // Track loading promises
  private unlistenValidationStarted?: () => void

  private enginePort?: number
  private engineApiKey?: string
  private presetPath?: string
  private engineStartLock: Promise<void> | null = null
  private userModelsMax: number = 1
  private engineEmbeddingBonus: number = 0
  private loadedChatOrder: string[] = []

  // The engine worker spawn runs off the onLoad critical path; awaited via
  // ensureEngineReady() before any model load so inference never races it.
  private backgroundInit?: Promise<void>
  /** Single-flight provisioning run; see ensureProvisioned(). */
  private provisioning?: Promise<void>

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    await this.migrateLocalStorageToFile()

    // The engine is bundled at a pinned version, so there is no backend or
    // version to migrate or select. `registerSettings` drops the keys that no
    // longer exist in SETTINGS (llamacpp_version, llamacpp_backend,
    // check_for_updates, auto_update_engine, verify_backend_deps) from the
    // persisted set on its own.
    const settings = structuredClone(SETTINGS)
    await this.registerSettings(settings)

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

    // Auto-fit is disabled by default on all platforms; ctx-size owns context
    // sizing. Force off for users a prior build left with fit enabled.
    await this.migrateFitOff()

    await this.migrateAutoUnloadToModelsMax()

    this.timeout = asI32(this.config.timeout, DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT
    this.llamacpp_env = this.config.llamacpp_env

    // This sets the base directory where model files for this provider are stored.
    await this.getProviderPath()

    await this.migratePersistedModelSettingsToYaml()

    // Set up validation event listeners to bridge Tauri events to frontend
    this.unlistenValidationStarted = await listen<{
      modelId: string
      downloadType: string
    }>('onModelValidationStarted', (event) => {
      events.emit(DownloadEvent.onModelValidationStarted, event.payload)
    })

    // Deferred off onLoad so the UI unblocks; performLoad awaits it via
    // ensureEngineReady(). The engine is bundled with the app now, so there is
    // no backend catalog fetch and no hundreds-of-megabytes download to ask
    // consent for -- only the fallback embedder, which bootstrapDefaultEmbedder
    // still gates on setup consent.
    this.backgroundInit = this.ensureProvisioned()
  }

  private async hasSetupConsent(): Promise<boolean> {
    try {
      return Boolean(await getBackendSetting(SETUP_CONSENT_KEY))
    } catch (e) {
      // A readable answer is not worth blocking startup over; erring towards
      // "not consented" only defers work the user can still trigger.
      logger.warn('Could not read the first-run setup flag:', e)
      return false
    }
  }

  /**
   * Runs the first-run provisioning the setup screen asked for, and remembers
   * that it was asked so a later launch does not wait again.
   */
  async startFirstRunSetup(): Promise<void> {
    try {
      await setBackendSetting(SETUP_CONSENT_KEY, 'true')
    } catch (e) {
      logger.warn('Could not persist the first-run setup flag:', e)
    }
    await this.ensureProvisioned()
  }

  /**
   * Starts the engine, then installs the fallback embedder. Single-flight:
   * startup, the setup screen and the first model load can all ask for it, and
   * only one run happens.
   *
   * There is no backend selection step any more -- the engine is linked into
   * the shipped worker at a pinned version, so the ordering dance between
   * "download a backend first" and "start first for availability" is gone.
   */
  private ensureProvisioned(): Promise<void> {
    this.provisioning ??= (async () => {
      try {
        await this.startEngine()
      } catch (e) {
        logger.error('Engine failed to start during provisioning:', e)
        this.reportMissingLibrariesFromError(e)
      }
      await this.bootstrapDefaultEmbedder()
    })()
    this.backgroundInit = this.provisioning
    return this.provisioning
  }

  /**
   * One-shot startup install of the fallback embedder so the router reserves
   * the +1 embedding slot from its first start instead of importing the model
   * mid-session on the first RAG call. Runs after the router is up so the
   * download never delays chat availability; the import's preset refresh then
   * resizes models_max via an idle restart (nothing is loaded yet at startup).
   * The persisted flag keeps this from resurrecting a model the user deleted,
   * and is only set on success so a failed download retries next launch.
   */
  private async bootstrapDefaultEmbedder(): Promise<void> {
    try {
      if (await getBackendSetting(EMBEDDER_BOOTSTRAP_KEY)) return
      if (!(await this.hasEmbedderInstalled())) {
        // Set only around the actual fetch, and only when there is one to do:
        // an install that is already present must not flash a pending state.
        this.embedderBootstrapping = true
        await this.import(FALLBACK_EMBEDDING_MODEL_ID, {
          modelPath: FALLBACK_EMBEDDING_MODEL_URL,
        })
        // A stopped or cancelled download resolves without throwing, so the
        // install has to be confirmed before the one-shot flag is recorded --
        // otherwise bootstrap marks itself done and never retries.
        if (!(await this.hasEmbedderInstalled())) {
          throw new Error(
            `Import of "${FALLBACK_EMBEDDING_MODEL_ID}" did not complete`
          )
        }
        logger.info(
          `Pre-installed fallback embedding model "${FALLBACK_EMBEDDING_MODEL_ID}" at startup`
        )
      }
      await setBackendSetting(EMBEDDER_BOOTSTRAP_KEY, 'true')
      this.embedderBootstrapError = undefined
    } catch (e) {
      this.embedderBootstrapError = e instanceof Error ? e.message : String(e)
      logger.warn(
        'Fallback embedder bootstrap failed (will import on demand):',
        e
      )
    } finally {
      // In `finally` so a thrown import cannot leave the checklist reporting
      // "downloading" for the rest of the session.
      this.embedderBootstrapping = false
    }
  }

  private async hasEmbedderInstalled(): Promise<boolean> {
    const models = await this.list()
    return models.some((m) => (m as { embedding?: boolean }).embedding === true)
  }

  /**
   * Why the startup embedder install failed, for setup to report. Undefined
   * when it succeeded or has not run; the import is retried on demand, so this
   * is advisory rather than terminal.
   */
  /**
   * A launch failure that names unresolvable libraries is the one dependency
   * problem a bundled engine still has: the GPU driver runtime (CUDA, Vulkan)
   * lives on the user's machine, not in the app. Raises the same dependency
   * dialog the old pre-flight backend verification did.
   */
  private reportMissingLibrariesFromError(error: unknown): void {
    const err = error as { code?: string; missing_libraries?: unknown }
    if (err?.code !== 'MISSING_SHARED_LIBRARY') return

    const libs = Array.isArray(err.missing_libraries)
      ? err.missing_libraries.filter(
          (lib): lib is string => typeof lib === 'string'
        )
      : []
    if (libs.length === 0) return

    // The engine is bundled, so there is no selected variant to name. The
    // unresolved library itself identifies the runtime that is missing, and
    // getBackendDisplayName matches on exactly these substrings.
    const joined = libs.join(' ').toLowerCase()
    const backend = ['cuda', 'vulkan', 'hip', 'metal'].find((b) =>
      joined.includes(b)
    )
    events.emit(AppEvent.onBackendVerificationFailed, {
      backend: backend ?? '',
      missingLibraries: libs,
    })
  }

  getEmbedderBootstrapError(): string | undefined {
    return this.embedderBootstrapError
  }

  /**
   * Proves the embedding model can actually produce a usable vector, rather
   * than inferring health from a completed download. Never throws: setup
   * reports the problem and lets the user continue.
   */
  async verifyEmbeddingModel(): Promise<EmbeddingModelReport> {
    // Downloading it is not a defect. Probing mid-download would fail on a
    // model that is simply not there yet and report a warning for it.
    if (this.embedderBootstrapping) {
      return { status: 'ok', pending: true }
    }

    let modelId: string | undefined
    try {
      const sInfo = await this.ensureEmbeddingModelLoaded()
      modelId = sInfo.model_id
      const response = await this.embed([EMBEDDING_PROBE_TEXT])
      const check = evaluateEmbeddingVector(response?.data?.[0]?.embedding)
      return {
        status: check.ok ? 'ok' : 'warning',
        modelId,
        dimension: check.dimension,
        problem: check.problem,
      }
    } catch (e) {
      // A failed startup install is the more specific cause, and it is the one
      // the user can act on.
      return {
        status: 'warning',
        modelId,
        error:
          this.getEmbedderBootstrapError() ??
          (e instanceof Error ? e.message : String(e)),
      }
    }
  }

  /**
   * Detects a GPU backend that runs entirely on the CPU. Such a router starts
   * cleanly and reports healthy, so this comparison against the engine's own
   * device list is the only signal that offload never happened.
   */
  async verifyGpuOffload(): Promise<GpuOffloadReport> {
    let devices: DeviceList[]
    try {
      devices = await this.getDevices()
    } catch (e) {
      // Without a device list there is no basis for a reason code, and guessing
      // one would point the user at the wrong fix.
      return {
        status: 'warning',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        error: e instanceof Error ? e.message : String(e),
      }
    }

    let hardwareGpuCount = 0
    try {
      hardwareGpuCount = (await getSystemInfo())?.gpus?.length ?? 0
    } catch (e) {
      logger.warn('Hardware GPU probe failed during setup verification:', e)
    }

    return {
      backend: backendFromDeviceIds(devices.map((d) => d.id)),
      ...evaluateGpuOffload({
        engineDeviceCount: devices.length,
        hardwareGpuCount,
      }),
    }
  }

  override async getSettings(): Promise<SettingComponentProps[]> {
    return readSettingsFile()
  }

  override async updateSettings(
    componentProps: Partial<SettingComponentProps>[]
  ): Promise<void> {
    const current = await readSettingsFile()
    const changed: { key: string; value: unknown }[] = []
    const updated = current.length
      ? current.map((s) => {
          const patch = componentProps.find((p) => p.key === s.key)
          if (patch?.controllerProps) {
            const nextValue = (patch.controllerProps as { value?: unknown })
              .value
            const prevValue = (s.controllerProps as { value?: unknown }).value
            if (nextValue !== prevValue) {
              changed.push({ key: s.key, value: nextValue })
            }
            ;(s.controllerProps as { value?: unknown }).value = nextValue
          }
          return s
        })
      : ((): SettingComponentProps[] => {
          const arr = componentProps as SettingComponentProps[]
          for (const s of arr) {
            changed.push({
              key: s.key,
              value: (s.controllerProps as { value?: unknown })?.value,
            })
          }
          return arr
        })()
    await writeSettingsFile(updated)
    for (const { key, value } of changed) {
      this.onSettingUpdate(key, value)
    }
  }

  override async registerSettings(
    settings: SettingComponentProps[]
  ): Promise<void> {
    settings.forEach((s) => {
      s.extensionName = this.name
    })
    const old = await readSettingsFile()
    if (old.length) {
      settings.forEach((s) => {
        const prev = old.find((o) => o.key === s.key)
        if (!prev) return
        const cp = s.controllerProps as Record<string, unknown>
        const pcp = prev.controllerProps as Record<string, unknown>
        if (pcp.value !== undefined) cp.value = pcp.value
        if ('options' in cp) {
          const newOptions = (cp.options as unknown[]) ?? []
          if (newOptions.length === 0 && Array.isArray(pcp.options)) {
            cp.options = pcp.options
          }
          const opts = (cp.options as { value: unknown }[]) ?? []
          if (opts.length && !opts.some((o) => o.value === cp.value)) {
            cp.value = opts[0]?.value
          }
        }
      })
    }
    await writeSettingsFile(settings)
  }

  // The ONLY sanctioned localStorage use in this extension: a one-time read +
  // clear migrating pre-backend llamacpp settings into the file store. All
  // other persistence goes through backend-settings.ts. Guarded by
  // no-localstorage.test.ts via the `localstorage-migration-allowed` markers.
  private async migrateLocalStorageToFile(): Promise<void> {
    if (await settingsFileExists()) return
    if (!this.name) return
    let raw: string | null = null
    try {
      raw = localStorage.getItem(this.name) // localstorage-migration-allowed
    } catch {
      raw = null
    }
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        await writeSettingsFile(parsed as SettingComponentProps[])
        logger.info(
          `Migrated llamacpp settings from localStorage → file (${parsed.length} entries)`
        )
      }
    } catch (e) {
      logger.warn('Failed to migrate localStorage settings to file:', e)
      return
    }
    try {
      localStorage.removeItem(this.name) // localstorage-migration-allowed
    } catch (e) {
      logger.warn('Failed to clear migrated localStorage entry:', e)
    }
  }

  /**
   * Serialized: two concurrent calls would each run the stop-then-spawn
   * sequence, and the second would kill the worker the first had just brought
   * up. A late caller gets the in-flight start rather than a restart.
   */
  private async startEngine(): Promise<void> {
    const inflight = this.engineStartLock
    if (inflight) {
      logger.info('startEngine already in progress; awaiting the in-flight run')
      await inflight.catch(() => undefined)
      return
    }
    this.engineStartLock = this.runStartEngine().finally(() => {
      this.engineStartLock = null
    })
    return this.engineStartLock
  }

  private async runStartEngine(): Promise<void> {
    const providerPath = await this.getProviderPath()
    const janDataFolderPath = await getJanDataFolderPath()
    const { path: presetPath, embeddingCount } = await generatePreset(
      providerPath,
      janDataFolderPath,
      this.config,
      {
        // The engine is pinned, so every build-number capability gate the
        // downloaded-backend era needed is statically known to hold.
        supportsMtp: true,
        reservedBackgroundSlots: (await readAutoGenerateTitleSetting()) ? 1 : 0,
      }
    )

    const modelsMax = this.resolveModelsMax(embeddingCount)

    // Idempotent in the plugin: a second start returns the running worker
    // rather than orphaning it, so a redundant call is a no-op instead of a
    // cold restart. That is also why there is no adoption dance here -- the
    // worker is a child of this process and dies with it.
    const envs: Record<string, string> = {}
    envs['LLAMA_ARG_TIMEOUT'] = String(this.timeout)
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env)

    const info = await startEngine(presetPath, modelsMax, envs)
    this.enginePort = info.port
    this.engineApiKey = info.api_key
    this.presetPath = presetPath
    logger.info(
      `Engine worker started on port ${info.port} (pid ${info.pid}, models_max=${modelsMax}, ${info.models.length} models registered, preset=${presetPath})`
    )
  }

  /**
   * `models_max` including the embedding slot bonus.
   *
   * Reserves one extra slot when any embedder is installed so loading it does
   * not evict the user's chat model. Only one embedding model is ever resident
   * (RAG calls load() once per request), so the bonus is +1 regardless of how
   * many are installed. 0 (unlimited) stays unlimited.
   */
  private resolveModelsMax(embeddingCount: number): number {
    const raw = (this.config as { models_max?: unknown }).models_max
    let modelsMax = 1
    if (typeof raw === 'number') modelsMax = raw
    else if (typeof raw === 'string' && raw.trim().length > 0) {
      const n = parseInt(raw, 10)
      if (!Number.isNaN(n) && n >= 0) modelsMax = n
    }
    this.userModelsMax = modelsMax
    const bonus = modelsMax > 0 && embeddingCount > 0 ? 1 : 0
    this.engineEmbeddingBonus = bonus
    return modelsMax + bonus
  }

  /**
   * Apply a preset change (model added/removed/renamed or a per-model setting)
   * to the running worker. Models whose preset section is unchanged stay
   * loaded, so an embedder import or a settings write no longer cold-reloads
   * the model the user is talking to.
   *
   * Unlike the router this also resizes `models_max`, so a change in the
   * embedding slot bonus no longer needs a restart either -- which was the one
   * remaining case that evicted a live chat model.
   */
  private async refreshEnginePreset(): Promise<void> {
    if (!(await this.getEngineInfo())) {
      await this.startEngine() // cold start
      return
    }

    const providerPath = await this.getProviderPath()
    const janDataFolderPath = await getJanDataFolderPath()
    const { path: presetPath, embeddingCount } = await generatePreset(
      providerPath,
      janDataFolderPath,
      this.config,
      {
        supportsMtp: true,
        reservedBackgroundSlots: (await readAutoGenerateTitleSetting()) ? 1 : 0,
      }
    )
    this.presetPath = presetPath

    try {
      const report = await reloadEngineModels(
        presetPath,
        this.resolveModelsMax(embeddingCount)
      )
      logger.info(
        `Engine preset reloaded: +${report.added.length} ~${report.changed.length} -${report.removed.length}, ${report.kept.length} kept loaded`
      )
    } catch (e) {
      logger.warn('Live engine reload failed; falling back to restart:', e)
      await this.startEngine()
    }
  }

  /**
   * Public accessor for downstream consumers. Returns `null` if the engine
   * worker hasn't started successfully yet.
   */
  async getEngineInfo(): Promise<{ port: number; apiKey: string } | null> {
    if (this.enginePort != null && this.engineApiKey) {
      return { port: this.enginePort, apiKey: this.engineApiKey }
    }
    try {
      const info = await pluginGetEngineInfo()
      if (info) {
        this.enginePort = info.port
        this.engineApiKey = info.api_key
        return { port: info.port, apiKey: info.api_key }
      }
    } catch (e) {
      logger.warn('get_engine_info failed:', e)
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
  async getModelProps(
    modelId: string
  ): Promise<
    | (ModelProps & {
        modalities?: { vision: boolean; video: boolean; audio: boolean }
      })
    | undefined
  > {
    const engine = await this.getEngineInfo()
    if (!engine || !modelId) return undefined
    // A request naming an unloaded model loads it on demand, so `/props` alone
    // would trigger a load. Gate on the loaded-set first.
    try {
      const loaded = await this.getLoadedModels()
      if (!loaded.includes(modelId)) return undefined
    } catch {
      return undefined
    }
    try {
      const url = `http://127.0.0.1:${engine.port}/props?model=${encodeURIComponent(modelId)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${engine.apiKey}` },
      })
      if (!res.ok) return undefined
      const json = (await res.json()) as {
        default_generation_settings?: { n_ctx?: number }
        total_slots?: number
        model_alias?: string
        is_sleeping?: boolean
        modalities?: { vision?: boolean; video?: boolean; audio?: boolean }
      }
      const n = json?.default_generation_settings?.n_ctx
      if (typeof n !== 'number' || n <= 0) return undefined
      const m = json.modalities
      return {
        nCtx: n,
        totalSlots:
          typeof json.total_slots === 'number' ? json.total_slots : undefined,
        modelAlias: json.model_alias,
        isSleeping: !!json.is_sleeping,
        modalities: m
          ? { vision: !!m.vision, video: !!m.video, audio: !!m.audio }
          : undefined,
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
    if (await getBackendSetting(MIGRATION_KEY)) return

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

    await setBackendSetting(MIGRATION_KEY, '1')
  }

  private async migrateFitOff(): Promise<void> {
    const MIGRATION_KEY = 'llamacpp_fit_off_v1'
    if (await getBackendSetting(MIGRATION_KEY)) return

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
      logger.info('Migrated fit setting: disabled')
    }

    await setBackendSetting(MIGRATION_KEY, '1')
  }

  private async migratePersistedModelSettingsToYaml(): Promise<void> {
    if (await getBackendSetting(LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY)) return

    const persistedModels = await readPersistedLlamacppModels()
    const providerPath = await this.getProviderPath()

    // v1's n_gpu_layers stamp lives in model.yml, not in the persisted
    // settings, so it has to be swept even when nothing is persisted.
    await this.stripLegacyNglFromModelYaml(providerPath)

    if (persistedModels.length === 0) {
      await setBackendSetting(LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY, '1')
      return
    }

    for (const persistedModel of persistedModels) {
      const modelId =
        typeof persistedModel.id === 'string' ? persistedModel.id : undefined
      if (!modelId || !persistedModel.settings) continue

      const configPath = await joinPath([
        providerPath,
        'models',
        modelId,
        'model.yml',
      ])
      if (!(await fs.existsSync(configPath))) continue

      const cfg = (await invoke<ModelConfig>('read_yaml', {
        path: configPath,
      })) as ModelConfig & Record<string, unknown>

      let touched = false

      // Undo v1's n_gpu_layers stamp so upstream's auto offload applies again.
      if (cfg.n_gpu_layers === LEGACY_NGL_DEFAULT) {
        delete (cfg as Record<string, unknown>).n_gpu_layers
        touched = true
        logger.info(
          `Removed legacy n_gpu_layers=${LEGACY_NGL_DEFAULT} from ${modelId}; GPU offload is auto again`
        )
      }

      for (const [sidebarKey, persistedSetting] of Object.entries(
        persistedModel.settings
      )) {
        const mapping = MODEL_SETTINGS_YAML_MAPPING[sidebarKey]
        if (!mapping) continue

        if (mapping.yamlKey in cfg) continue

        const value = persistedSetting?.controller_props?.value
        // Never re-copy the legacy default; that is what v1 did.
        if (sidebarKey === 'ngl' && Number(value) === LEGACY_NGL_DEFAULT) {
          continue
        }

        const next = mapping.coerce(value)
        if (next === null) continue

        ;(cfg as Record<string, unknown>)[mapping.yamlKey] = next
        touched = true
      }

      if (touched) {
        await invoke<void>('write_yaml', { data: cfg, savePath: configPath })
      }
    }

    await setBackendSetting(LLAMACPP_MODEL_SETTINGS_BACKFILL_KEY, '1')
  }

  /**
   * Removes v1's `n_gpu_layers: 100` stamp from every model.yml.
   *
   * Separate from the settings backfill because the stamp is in the yaml even
   * for models that no longer appear in the persisted provider settings, so
   * iterating the persisted list would miss them.
   */
  private async stripLegacyNglFromModelYaml(providerPath: string): Promise<void> {
    const modelsDir = await joinPath([providerPath, 'models'])
    if (!(await fs.existsSync(modelsDir))) return

    let entries: string[] = []
    try {
      entries = await fs.readdirSync(modelsDir)
    } catch (e) {
      logger.warn('Could not list models while sweeping legacy ngl:', e)
      return
    }

    for (const entry of entries) {
      const configPath = await joinPath([entry, 'model.yml'])
      try {
        if (!(await fs.existsSync(configPath))) continue
        // Read as a bag rather than ModelConfig: that type covers the
        // plugin's own fields, not every per-model key the sidebar writes.
        const cfg = await fs.readYaml<Record<string, unknown>>(configPath)
        if (cfg?.n_gpu_layers !== LEGACY_NGL_DEFAULT) continue
        delete cfg.n_gpu_layers
        await fs.writeYaml(configPath, cfg)
        logger.info(
          `Removed legacy n_gpu_layers=${LEGACY_NGL_DEFAULT} from ${configPath}`
        )
      } catch (e) {
        // Per-model isolation: one unreadable yaml must not block the sweep.
        logger.warn(`Legacy ngl sweep skipped ${configPath}:`, e)
      }
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

    // Deliberately does NOT stop the engine worker. It outlives any single
    // extension instance: the app owns its lifetime and stops it on
    // ExitRequested/Exit. An extension teardown is not an app exit -- React
    // StrictMode and HMR both unload and immediately reload us, and awaiting
    // backgroundInit here (as this used to) meant blocking until the worker was
    // up, then killing exactly the process it had just started.
    this.enginePort = undefined
    this.engineApiKey = undefined
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value

    if (key === 'llamacpp_env') {
      this.llamacpp_env = value as string
    } else if (key === 'timeout') {
      // Clamped through the plugin's own coercion: the field is a text input, so
      // clearing it yields '' and a bare cast produced NaN. 0 or negative would
      // make the request timeout fire immediately and abort every stream.
      this.timeout = asI32(value, DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT
    } else if (key === 'models_max') {
      // Not a `[*]` preset key, so it is deliberately absent from
      // PRESET_AFFECTING_KEYS -- but the worker still has to be told, or
      // "Max Concurrently Loaded Models" only ever updated this.config.
      this.schedulePresetRefresh()
    } else if (PRESET_AFFECTING_KEYS.has(key)) {
      // The running worker was started with the previous preset; without a
      // reload the new value is invisible to inference. Debounced so a flurry
      // of slider/dropdown updates collapses into one bounce.
      this.schedulePresetRefresh()
    }
  }

  private presetRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private schedulePresetRefresh(): void {
    if (this.presetRefreshTimer) clearTimeout(this.presetRefreshTimer)
    this.presetRefreshTimer = setTimeout(() => {
      this.presetRefreshTimer = null
      this.refreshEnginePreset().catch((e) =>
        logger.warn('Preset refresh after settings update failed:', e)
      )
    }, 600)
  }

  private async generateApiKey(modelId: string, port: string): Promise<string> {
    const hash = await pluginGenerateApiKey(modelId + port, this.apiSecret)
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
    await this.resolveMtpLayersConfig(modelId, modelConfig)
    const templateKwargs = await this.resolveTemplateKwargsConfig(
      modelId,
      modelConfig
    )

    return {
      id: modelId,
      name: modelConfig.name ?? modelId,
      quant_type: undefined, // TODO: parse quantization type from model.yml or model.gguf
      providerId: this.provider,
      port: 0, // port is not known until the model is loaded
      sizeBytes: modelConfig.size_bytes ?? 0,
      embedding: isEmbedding,
      template_kwargs: templateKwargs,
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

  private async resolveMtpLayersConfig(
    modelId: string,
    modelConfig: ModelConfig
  ): Promise<number> {
    const cfg = modelConfig as ModelConfig & {
      mtp_layers?: number
      mtp_check_v?: number
    }
    if (
      typeof cfg.mtp_layers === 'number' &&
      cfg.mtp_check_v === MTP_CHECK_VERSION
    ) {
      return cfg.mtp_layers
    }

    let mtpLayers = 0
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const fullModelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])
      if (await fs.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath)
        mtpLayers = detectMtpLayersFromGgufMeta(metadata.metadata)
      }
    } catch (e) {
      logger.warn(`Failed to check MTP metadata for ${modelId}`, e)
      return cfg.mtp_layers ?? 0
    }

    try {
      const configPath = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
        'model.yml',
      ])
      cfg.mtp_layers = mtpLayers
      cfg.mtp_check_v = MTP_CHECK_VERSION
      await invoke<void>('write_yaml', {
        data: cfg,
        savePath: configPath,
      })
    } catch (e) {
      logger.warn(`Failed to persist MTP layers for ${modelId}`, e)
    }

    return mtpLayers
  }

  /**
   * Detect which chat-template kwargs (e.g. `preserve_thinking`) a model's
   * embedded jinja template accepts, caching the result in model.yml. Migrates
   * pre-existing models lazily the first time list() sees a stale check version.
   */
  private async resolveTemplateKwargsConfig(
    modelId: string,
    modelConfig: ModelConfig
  ): Promise<TemplateKwarg[]> {
    const cfg = modelConfig as ModelConfig & {
      template_kwargs?: TemplateKwarg[]
      template_kwargs_check_v?: number
    }
    if (
      Array.isArray(cfg.template_kwargs) &&
      cfg.template_kwargs_check_v === TEMPLATE_KWARGS_CHECK_VERSION
    ) {
      return cfg.template_kwargs
    }

    let kwargs: TemplateKwarg[] = []
    try {
      const janDataFolderPath = await getJanDataFolderPath()
      const fullModelPath = await joinPath([
        janDataFolderPath,
        modelConfig.model_path,
      ])
      if (await fs.existsSync(fullModelPath)) {
        const metadata = await readGgufMetadata(fullModelPath)
        kwargs = detectTemplateKwargsFromChatTemplate(
          metadata.metadata?.['tokenizer.chat_template']
        )
      }
    } catch (e) {
      logger.warn(`Failed to check template kwargs for ${modelId}`, e)
      return cfg.template_kwargs ?? []
    }

    try {
      const configPath = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
        'model.yml',
      ])
      cfg.template_kwargs = kwargs
      cfg.template_kwargs_check_v = TEMPLATE_KWARGS_CHECK_VERSION
      await invoke<void>('write_yaml', {
        data: cfg,
        savePath: configPath,
      })
    } catch (e) {
      logger.warn(`Failed to persist template kwargs for ${modelId}`, e)
    }

    return kwargs
  }

  // Implement the required LocalProvider interface methods
  override async list(): Promise<modelInfo[]> {
    const modelsDir = await joinPath([await this.getProviderPath(), 'models'])
    if (!(await fs.existsSync(modelsDir))) {
      await fs.mkdir(modelsDir)
    }

    // Legacy migration is best-effort: a failure here must never blank the
    // model list. Pre-router users without anything to migrate would never
    // notice, but a single throw used to bubble out of list() and return [].
    try {
      await this.migrateLegacyModels()
    } catch (err) {
      logger.warn(`list: migrateLegacyModels failed, continuing: ${String(err)}`)
    }

    let modelIds: string[] = []

    // DFS. Mirror the defensive pattern in preset.ts: an unreadable entry
    // (Windows AV quarantine, junction, locked file) must not kill the whole
    // scan — log and continue past it.
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

      let children: string[] = []
      try {
        children = await fs.readdirSync(currentDir)
      } catch (err) {
        logger.warn(`list: readdir failed for ${currentDir}: ${String(err)}`)
        continue
      }
      for (const child of children) {
        try {
          const dirInfo = await fs.fileStat(child)
          if (!dirInfo?.isDirectory) continue
          stack.push(child)
        } catch (err) {
          logger.warn(`list: stat failed for ${child}: ${String(err)}`)
        }
      }
    }

    // Per-model isolation: one malformed model.yml (or a write_yaml failure
    // inside resolveEmbeddingConfig) must not discard the other entries.
    let modelInfos: modelInfo[] = []
    for (const modelId of modelIds) {
      try {
        const path = await joinPath([modelsDir, modelId, 'model.yml'])
        const modelConfig = await invoke<ModelConfig>('read_yaml', { path })
        const isEmbedding = await this.resolveEmbeddingConfig(
          modelId,
          modelConfig
        )
        const templateKwargs = await this.resolveTemplateKwargsConfig(
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
          // 'video' is intentionally NOT derived from the mmproj here — video
          // support also depends on the backend being built with MTMD_VIDEO,
          // which the GGUF can't reveal. It's reconciled from /props after the
          // model loads (see useReconcileVideoCapability).
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
          template_kwargs: templateKwargs,
        } as modelInfo
        modelInfos.push(modelInfo)
      } catch (err) {
        logger.warn(`list: skipping model ${modelId}: ${String(err)}`)
      }
    }

    return modelInfos
  }

  private async migrateLegacyModels() {
    // Attempt to migrate only once
    if ((await getBackendSetting('cortex_models_migrated')) === 'true') return

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
          logger.error(`Error migrating model ${child}:`, error)
        }
      }

      let subdirs: string[] = []
      try {
        subdirs = await fs.readdirSync(currentDir)
      } catch (err) {
        logger.warn(
          `migrateLegacyModels: readdir failed for ${currentDir}: ${String(err)}`
        )
        continue
      }
      for (const child of subdirs) {
        try {
          const dirInfo = await fs.fileStat(child)
          if (!dirInfo?.isDirectory) continue
          stack.push(child)
        } catch (err) {
          logger.warn(
            `migrateLegacyModels: stat failed for ${child}: ${String(err)}`
          )
        }
      }
    }
    await setBackendSetting('cortex_models_migrated', 'true')
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

    // The router's preset still references the old model id until we
    // regenerate; without this a `POST /models/load <new-id>` would 404.
    try {
      await this.refreshEnginePreset()
    } catch (e) {
      logger.warn(`Router restart after model rename (${modelId} → ${model.id}) failed`, e)
    }
  }

  /**
   * Joins concurrent imports of the same model instead of starting a second one.
   * Two callers racing (startup embedder bootstrap and an on-demand embed) both
   * passed the `model.yml` existence guard, then registered the same download
   * task id -- which Rust resolves by cancelling the first and deleting its
   * partial file. The loser then returned without writing `model.yml`, so its
   * caller went on to load a model that was never installed.
   */
  override async import(modelId: string, opts: ImportOptions): Promise<void> {
    const inFlight = this.pendingImports.get(modelId)
    if (inFlight) {
      logger.info(`Joining in-flight import of "${modelId}"`)
      return inFlight
    }

    const task = this.runImport(modelId, opts).finally(() => {
      this.pendingImports.delete(modelId)
    })
    this.pendingImports.set(modelId, task)
    return task
  }

  private async runImport(modelId: string, opts: ImportOptions): Promise<void> {
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
          proxy: await getProxyConfig(),
          sha256:
            saveName === 'model.gguf'
              ? opts.modelSha256
              : saveName === 'mmproj.gguf'
                ? opts.mmprojSha256
                : undefined,
          size:
            saveName === 'model.gguf'
              ? opts.modelSize
              : saveName === 'mmproj.gguf'
                ? opts.mmprojSize
                : undefined,
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
    // MTP draft companion (speculative decoding); paired with the main model.
    let mtpModelPath = opts.mtpPath
      ? await maybeDownload(opts.mtpPath, 'mtp.gguf')
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

        // Pause and cancel both surface here as a cancellation; treat as a
        // stop (emit stopped, return) so it never becomes an error toast.
        if (isCancellationError) {
          logger.info('Download stopped for model:', modelId)
          events.emit(DownloadEvent.onFileDownloadStopped, {
            modelId,
            downloadType: 'Model',
          })
          return
        }

        logger.error('Error downloading model:', modelId, opts, error)
        if (isValidationError) {
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
    let mtpLayers = 0
    let templateKwargs: TemplateKwarg[] = []
    let resolvedName: string | undefined

    try {
      // Validate main model file
      const modelMetadata = await readGgufMetadata(fullModelPath)
      logger.info(
        `Model GGUF validation successful: version ${modelMetadata.version}, tensors: ${modelMetadata.tensor_count}`
      )

      if (detectEmbeddingFromGgufMeta(modelMetadata.metadata)) {
        isEmbedding = true
      }
      mtpLayers = detectMtpLayersFromGgufMeta(modelMetadata.metadata)
      templateKwargs = detectTemplateKwargsFromChatTemplate(
        modelMetadata.metadata?.['tokenizer.chat_template']
      )

      const rawName = modelMetadata.metadata?.['general.name']
      if (typeof rawName === 'string') {
        const normalized = rawName.trim().replace(/\s+/g, '-')
        if (normalized.length > 0) resolvedName = normalized
      }

      // Validate mmproj file if present
      if (mmprojPath) {
        const fullMmprojPath = await joinPath([janDataFolderPath, mmprojPath])
        const mmprojMetadata = await readGgufMetadata(fullMmprojPath)
        logger.info(
          `Mmproj GGUF validation successful: version ${mmprojMetadata.version}, tensors: ${mmprojMetadata.tensor_count}`
        )
      }

      // Validate MTP draft and read its head count (the main gguf usually
      // lacks nextn_predict_layers when MTP ships as a separate file).
      if (mtpModelPath) {
        const fullMtpPath = await joinPath([janDataFolderPath, mtpModelPath])
        const mtpMetadata = await readGgufMetadata(fullMtpPath)
        const draftLayers = detectMtpLayersFromGgufMeta(mtpMetadata.metadata)
        mtpLayers = draftLayers > 0 ? draftLayers : Math.max(mtpLayers, 1)
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
    if (mtpModelPath) {
      size_bytes += (
        await fs.fileStat(await joinPath([janDataFolderPath, mtpModelPath]))
      ).size
    }

    if (!resolvedName) {
      const base = opts.modelPath.split(/[\\/]/).pop() ?? modelId
      resolvedName = base.replace(/\.gguf$/i, '') || modelId
    }

    // TODO: add updateModelConfig() method
    const modelConfig = {
      model_path: modelPath,
      mmproj_path: mmprojPath,
      name: resolvedName,
      size_bytes,
      model_sha256: opts.modelSha256,
      model_size_bytes: opts.modelSize,
      mmproj_sha256: opts.mmprojSha256,
      mmproj_size_bytes: opts.mmprojSize,
      embedding: isEmbedding,
      embedding_check_v: EMBEDDING_CHECK_VERSION,
      mtp_layers: mtpLayers,
      mtp_check_v: MTP_CHECK_VERSION,
      template_kwargs: templateKwargs,
      template_kwargs_check_v: TEMPLATE_KWARGS_CHECK_VERSION,
      // A separate draft gguf is downloaded only to be used — enable MTP by
      // default. Embedded-MTP models keep MTP opt-in (no flag written here).
      ...(mtpModelPath ? { mtp_model_path: mtpModelPath, mtp: true } : {}),
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
      await this.refreshEnginePreset()
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

  override async pauseImport(modelId: string): Promise<void> {
    const taskId = this.createDownloadTaskId(modelId)
    const downloadManager = window.core.extensionManager.getByName(
      '@janhq/download-extension'
    )
    // Pause keeps the partial .tmp for resume; the model folder is preserved.
    await downloadManager.pauseDownload(taskId)
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
    _settings?: unknown,
    isEmbedding: boolean = false
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

  // Awaits the deferred startup, then makes one direct attempt if the worker
  // still isn't up. Safe to call redundantly: start_engine returns the running
  // worker rather than spawning a second one.
  private async ensureEngineReady(): Promise<void> {
    await this.ensureProvisioned().catch(() => undefined)
    if (!(await this.getEngineInfo())) {
      await this.startEngine()
    }
  }

  private async performLoad(
    modelId: string,
    isEmbedding: boolean = false
  ): Promise<SessionInfo> {
    await this.ensureEngineReady()
    if (!(await this.getEngineInfo())) {
      throw new Error(
        'The llama.cpp engine is not running. Please restart the app.'
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

  /**
   * The id becomes a Tauri event name (`download-<taskId>`), which cannot contain
   * a dot. Dots are replaced rather than truncated at: truncating collapsed every
   * `Jan-v3.*` quant onto one id, and Rust cancels an in-flight task whose id
   * repeats -- deleting its partial file -- so downloading one quant destroyed
   * another's, and pause/cancel hit whichever quant happened to be registered.
   */
  private createDownloadTaskId(modelId: string) {
    // prepend provider to make taskId unique across providers
    return `${this.provider}/${modelId.replace(/\./g, '-')}`
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
      return await pluginFindSessionByModel(modelId)
    } catch (e) {
      logger.error(e)
      throw new Error(String(e))
    }
  }

  private async ensureHealthySession(modelId: string): Promise<SessionInfo> {
    return pluginEnsureSessionReady(modelId, false)
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
    // Per-chunk timings so callers can track live token counts during
    // generation instead of only once the stream finishes.
    opts.timings_per_token = true

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
      await this.refreshEnginePreset()
    } catch (e) {
      logger.warn(`Router refresh after delete(${modelId}) failed:`, e)
    }
  }

  override async getLoadedModels(): Promise<string[]> {
    try {
      let models: string[] = await pluginGetLoadedModels()
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

  async getMtpInfo(modelId: string): Promise<{
    mtp_layers: number
    mtp: boolean
    spec_draft_n_max?: number
    spec_draft_n_min?: number
    spec_draft_p_min?: number
  }> {
    const path = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
      'model.yml',
    ])
    if (!(await fs.existsSync(path))) {
      return { mtp_layers: 0, mtp: false }
    }
    const cfg = (await invoke<ModelConfig>('read_yaml', { path })) as ModelConfig & {
      mtp_layers?: number
      mtp?: boolean
      spec_draft_n_max?: number
      spec_draft_n_min?: number
      spec_draft_p_min?: number
    }
    return {
      mtp_layers: typeof cfg.mtp_layers === 'number' ? cfg.mtp_layers : 0,
      mtp: cfg.mtp === true,
      spec_draft_n_max: cfg.spec_draft_n_max,
      spec_draft_n_min: cfg.spec_draft_n_min,
      spec_draft_p_min: cfg.spec_draft_p_min,
    }
  }

  async updateMtpSettings(
    modelId: string,
    patch: {
      mtp?: boolean
      spec_draft_n_max?: number | null
      spec_draft_n_min?: number | null
      spec_draft_p_min?: number | null
    }
  ): Promise<void> {
    const configPath = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
      'model.yml',
    ])
    if (!(await fs.existsSync(configPath))) {
      throw new Error(`model.yml not found for ${modelId}`)
    }
    const cfg = (await invoke<ModelConfig>('read_yaml', { path: configPath })) as ModelConfig & {
      mtp?: boolean
      spec_draft_n_max?: number
      spec_draft_n_min?: number
      spec_draft_p_min?: number
    }

    if (typeof patch.mtp === 'boolean') cfg.mtp = patch.mtp
    const assignNumeric = (
      key: 'spec_draft_n_max' | 'spec_draft_n_min' | 'spec_draft_p_min',
      value: number | null | undefined
    ) => {
      if (value === null) {
        delete cfg[key]
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        cfg[key] = value
      }
    }
    if ('spec_draft_n_max' in patch) assignNumeric('spec_draft_n_max', patch.spec_draft_n_max)
    if ('spec_draft_n_min' in patch) assignNumeric('spec_draft_n_min', patch.spec_draft_n_min)
    if ('spec_draft_p_min' in patch) assignNumeric('spec_draft_p_min', patch.spec_draft_p_min)

    await invoke<void>('write_yaml', { data: cfg, savePath: configPath })

    try {
      await this.refreshEnginePreset()
    } catch (e) {
      logger.warn(`Failed to restart router after MTP update for ${modelId}`, e)
    }
  }

  /**
   * Persist a per-model setting from the sidebar into `model.yml`, regenerate
   * the router preset, and restart the router so the next inference picks up
   * the new args. In router mode the router reads args exclusively from
   * `router.preset.ini`, so updating Zustand alone has no effect on inference.
   *
   * Sidebar keys are mapped to the canonical `model.yml` / preset keys here.
   * Keys not in the mapping are silently ignored — they're either Jan-side
   * concerns (`reasoning`, `auto_increase_ctx_len`) or not yet emitted by
   * `preset.ts` (deferred to phase b).
   */
  async updateModelSettings(
    modelId: string,
    patch: Record<string, string | number | boolean | null | undefined>
  ): Promise<void> {
    const configPath = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
      'model.yml',
    ])
    if (!(await fs.existsSync(configPath))) {
      throw new Error(`model.yml not found for ${modelId}`)
    }
    const cfg = (await invoke<ModelConfig>('read_yaml', {
      path: configPath,
    })) as ModelConfig & Record<string, unknown>

    let touched = false
    for (const [sidebarKey, value] of Object.entries(patch)) {
      const m = MODEL_SETTINGS_YAML_MAPPING[sidebarKey]
      if (!m) continue
      const next = m.coerce(value)
      if (next === null) {
        if (m.yamlKey in cfg) {
          delete (cfg as Record<string, unknown>)[m.yamlKey]
          touched = true
        }
      } else {
        ;(cfg as Record<string, unknown>)[m.yamlKey] = next
        touched = true
      }
    }

    if (!touched) return

    await invoke<void>('write_yaml', { data: cfg, savePath: configPath })

    try {
      await this.refreshEnginePreset()
    } catch (e) {
      logger.warn(
        `Failed to restart router after model settings update for ${modelId}`,
        e
      )
    }
  }

  async getDevices(): Promise<DeviceList[]> {
    // set envs
    const envs: Record<string, string> = {}
    if (this.llamacpp_env) this.parseEnvFromString(envs, this.llamacpp_env)

    try {
      const dList = await engineDevices(envs)
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

  /**
   * Resolves the default/preferred embedding model, importing and loading
   * sentence-transformer-mini as the fallback, then ensures a session exists.
   * Shared by embed() and getEmbeddingContextSize() so both agree on which
   * model is "the" embedding model.
   */
  private async ensureEmbeddingModelLoaded(): Promise<SessionInfo> {
    const downloadedModelList = await this.list()
    const installedEmbedding = downloadedModelList.filter(
      (m) => (m as any).embedding === true
    )
    const hasMini = downloadedModelList.some(
      (m) => m.id === FALLBACK_EMBEDDING_MODEL_ID
    )
    let preferred = await getDefaultEmbeddingModelId('llamacpp')

    if (!preferred && installedEmbedding.length === 1 && !hasMini) {
      preferred = installedEmbedding[0].id
      await setDefaultEmbeddingModelId('llamacpp', preferred)
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
      : FALLBACK_EMBEDDING_MODEL_ID

    let sInfo = await this.findSessionByModel(targetModelId)
    if (!sInfo) {
      if (targetModelId === FALLBACK_EMBEDDING_MODEL_ID && !hasMini) {
        await this.import(FALLBACK_EMBEDDING_MODEL_ID, {
          modelPath: FALLBACK_EMBEDDING_MODEL_URL,
        })
      }
      sInfo = await this.load(targetModelId, undefined, true)
    }
    return sInfo as SessionInfo
  }

  /**
   * Actual post-fit context window of the embedding model, read from the
   * router's /props endpoint (the same source getModelProps uses for chat
   * models). Used by RAG ingestion to size chunks so they don't exceed the
   * model's n_ctx (e.g. sentence-transformer-mini natively caps at 256).
   */
  async getEmbeddingContextSize(): Promise<number | undefined> {
    const sInfo = await this.ensureEmbeddingModelLoaded()
    const props = await this.getModelProps(sInfo.model_id)
    return props?.nCtx
  }

  /**
   * Real token counts from the embedding model's own tokenizer via /tokenize
   * on its session port. Char-based chunking can't reliably predict token
   * count (subword tokenizers vary widely by content), so callers that need
   * a hard guarantee against exceed_context_size_error should verify with
   * this rather than estimating from character length.
   */
  async countEmbeddingTokens(texts: string[]): Promise<number[]> {
    const sInfo = await this.ensureEmbeddingModelLoaded()
    const counts: number[] = []
    for (const text of texts) {
      const res = await fetch(`http://localhost:${sInfo.port}/tokenize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sInfo.api_key}`,
        },
        body: JSON.stringify({ content: text, model: sInfo.model_id }),
      })
      if (!res.ok) {
        throw new Error(`Tokenize request failed with status ${res.status}`)
      }
      const json = (await res.json()) as { tokens?: unknown[] }
      counts.push(Array.isArray(json.tokens) ? json.tokens.length : 0)
    }
    return counts
  }

  /**
   * Token budget for one embedding request.
   *
   * Deliberately not the engine-wide `ubatch_size`: preset.ts pins every
   * embedding model's section to its own ubatch (DEFAULT_EMBEDDING_UBATCH) and
   * to `ctx-size = 0`, so the real ceiling is the embedder's own trained
   * context -- 512 on MiniLM. llama.cpp rejects a batch wider than either with
   * no retry path, so the budget is the smaller of the two.
   */
  private async embedBatchBudget(sInfo: SessionInfo): Promise<number> {
    let budget = DEFAULT_EMBEDDING_UBATCH
    try {
      const props = await this.getModelProps(sInfo.model_id)
      const nCtx = props?.nCtx
      if (typeof nCtx === 'number' && nCtx > 0) {
        budget = Math.min(budget, nCtx)
      }
    } catch (e) {
      // Without /props the pinned ubatch is still a valid ceiling.
      logger.warn('Could not read embedder context size; using the pinned ubatch:', e)
    }
    return budget
  }

  async embed(text: string[]): Promise<EmbeddingResponse> {
    const sInfo = await this.ensureEmbeddingModelLoaded()
    const batches = buildEmbedBatches(text, await this.embedBatchBudget(sInfo))

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
      const response = await attemptRequest(sInfo, batchInput)
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
      sInfo.model_id,
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
