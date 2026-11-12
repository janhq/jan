// Types
export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  is_embedding: boolean
  api_key: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

/** Mirrors `engine::worker::DeviceIdentity`: a device without its memory. */
export interface DeviceIdentity {
  id: string
  name: string
}

/** Mirrors `engine::commands::EngineInfo`. */
export interface EngineInfo {
  port: number
  api_key: string
  pid: number
  /** Model ids the worker registered from the preset. */
  models: string[]
  /**
   * The devices the running worker itself initialised, or null when it did not
   * say. `[]` means the machine has no GPU, which is a real answer. The worker
   * lists its devices once, at start, so this is what a later enumeration is
   * compared against to notice a GPU that appeared or vanished.
   */
  devices: DeviceIdentity[] | null
}

/** Mirrors `engine::commands::EngineVersion`. */
export interface EngineVersion {
  /** llama.cpp's own version, e.g. "0.9.0". */
  version: string
  /** Upstream build tag the source was taken from, e.g. "b12110". */
  tag: string
  /** The tag's build number, as a string. */
  build_number: string
  /** Full commit sha -- the tag is mutable upstream, this is the real pin. */
  commit: string
}

/**
 * Mirrors `engine::commands::ReloadReport`. Every model in the preset appears
 * in exactly one list, so an empty `changed`/`removed` proves the reload left
 * the models the user was using alone.
 */
export interface ReloadReport {
  added: string[]
  changed: string[]
  removed: string[]
  kept: string[]
  models_max: number
}

export interface ModelProps {
  nCtx: number
  totalSlots?: number
  modelAlias?: string
  isSleeping?: boolean
}

export interface GgufMetadata {
  version: number
  tensor_count: number
  metadata: Record<string, string>
}

/**
 * The engine-level (provider-wide) settings, mirroring
 * `extensions/llamacpp-extension/settings.json` exactly.
 *
 * Kept in lockstep on purpose: `this.config` is built only from those keys, so a
 * field declared here with no settings.json entry is permanently `undefined` --
 * which is how two dead `[*]` preset branches (`ctx_size`, `n_gpu_layers`) came
 * to typecheck. Per-model settings are a different type (`ModelConfig`).
 */
export type LlamacppConfig = {
  llamacpp_env: string
  models_max: string | number
  timeout: number
  fit: boolean
  fit_target: string
  fit_ctx: string
  threads: number
  threads_batch: number
  ctx_shift: boolean
  n_predict: number
  batch_size: number
  ubatch_size: number
  n_cpu_moe: number
  n_cpu_ffn: number
  no_kv_offload: boolean
  device: string
  split_mode: string
  main_gpu: number
  tensor_split: string
  no_op_offload: boolean
  flash_attn: string
  parallel: number
  cont_batching: boolean
  no_mmap: boolean
  mlock: boolean
  cache_type_k: string
  cache_type_v: string
  rope_scaling: string
  rope_freq_base: number
  rope_freq_scale: number
  cache_ram: number
  /** Keep each thread's prompt cache on disk across sessions. */
  persist_thread_cache: boolean
  /** Disk budget for the above, in MiB. */
  thread_cache_size: number
  cache_reuse: number
  ctx_checkpoints: number
  checkpoint_min_step: number
  swa_full: boolean
  kv_unified: string
  /** Per-slot cap on the shared KV pool, in tokens. 0 = unset. */
  kv_unified_per_slot: number
  /** Keep reasoning for the whole history, not just the last assistant turn. */
  reasoning_preserve: boolean
  /** On-demand reading of arch-marked tensors: `auto` | `on` | `off`. */
  lazy_mode: string
  keep: number
}

export interface DownloadItem {
  url: string
  save_path: string
  proxy?: Record<string, string | string[] | boolean>
  sha256?: string
  size?: number
  model_id?: string
}

export interface ModelConfig {
  model_path: string
  mmproj_path?: string
  name: string // user-friendly
  // some model info that we cache upon import
  size_bytes: number
  sha256?: string
  mmproj_sha256?: string
  mmproj_size_bytes?: number
  embedding?: boolean
  template_kwargs?: TemplateKwarg[]
  template_kwargs_check_v?: number
}

export type TemplateKwargType = 'boolean' | 'number' | 'string'

export interface TemplateKwarg {
  name: string
  type: TemplateKwargType
  default: boolean | number | string
}

export interface EmbeddingResponse {
  model: string
  object: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
  data: EmbeddingData[]
}

export interface EmbeddingData {
  embedding: number[]
  index: number
  object: string
}

export interface DeviceList {
  id: string
  name: string
  mem: number
  free: number
}


// The ggml op diagnostic. These mirror `engine::diagnose::RootEvent` and
// `engine::diag`; see docs/llamacpp-diagnostics/event-schema.md.

/** Bump in lockstep with `engine::diagnose::SCHEMA_VERSION`. */
export const DIAGNOSTICS_SCHEMA = 2

/**
 * `model` runs only the families one gguf's graph contains, at its own
 * shapes, and needs the model id passed with it.
 */
export type DiagnosticsPreset = 'quick' | 'full' | 'model'

/**
 * A case outcome. `not_supported` is not a failure: the device is saying ggml
 * will run that op somewhere else, which explains slowness rather than a wrong
 * answer.
 */
export type DiagnosticsCaseStatus =
  | 'ok'
  | 'fail'
  | 'not_supported'
  | 'skipped'

/**
 * A family outcome. Only `fail` means a kernel computed the wrong answer; the
 * other three are the leaf process itself going wrong.
 */
export type DiagnosticsFamilyStatus =
  | 'ok'
  | 'fail'
  /**
   * The family ran cleanly and tested nothing, because its shape filter
   * matched no case. Inconclusive, never a pass.
   */
  | 'no_cases'
  | 'crashed'
  | 'hung'
  | 'cancelled'

export type DiagnosticsDeviceKind =
  | 'cpu'
  | 'gpu'
  | 'igpu'
  | 'accel'
  | 'meta'
  | 'unknown'

export interface DiagnosticsDevice {
  name: string
  description: string
  type: DiagnosticsDeviceKind
  reg: string
  memory_total_mib?: number
  memory_free_mib?: number
}

export interface DiagnosticsEngineBuild {
  version: string
  tag: string
  commit: string
}

interface DiagnosticsEventBase {
  job: string
}

export type DiagnosticsEvent = DiagnosticsEventBase &
  (
    | {
        event: 'start'
        schema: number
        preset: DiagnosticsPreset
        engine: DiagnosticsEngineBuild
        families: string[]
        /** The model file this run was built for, on the `model` preset. */
        model?: string
        support_probe: boolean
        backend_modules: string[]
        units: number
        family_timeout_secs: number
        deadline_secs: number
      }
    | ({ event: 'device' } & DiagnosticsDevice)
    | {
        event: 'family_start'
        device: string
        family: string
        mode: 'test' | 'support'
      }
    | {
        event: 'case'
        device: string
        family: string
        backend: string
        op: string
        params: string
        mode: string
        status: DiagnosticsCaseStatus
        error?: string
        detail?: string
      }
    | {
        event: 'family_end'
        device: string
        family: string
        status: DiagnosticsFamilyStatus
        ok: number
        failed: number
        not_supported: number
        millis: number
        exit?: string
        last_lines?: string[]
        unparsed?: string[]
      }
    | {
        event: 'summary'
        device: string
        ok: number
        failed: number
        not_supported: number
        families_crashed: number
        families_hung: number
        /** Families whose filter matched no case, so they tested nothing. */
        families_no_cases?: number
        /** Families the run never reached, because it was cancelled or timed out. */
        families_cancelled?: number
      }
    | {
        event: 'done'
        ok: boolean
        cancelled: boolean
        /**
         * At least one family tested nothing, so the run did not cover what
         * it was asked to. `ok` is false in this case too -- read this flag
         * to tell it apart from a real failure.
         */
        inconclusive?: boolean
        error?: string
      }
  )

export interface DiagnosticsJob {
  id: string
}
