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

/** Mirrors `engine::commands::EngineInfo`. */
export interface EngineInfo {
  port: number
  api_key: string
  pid: number
  /** Model ids the worker registered from the preset. */
  models: string[]
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

