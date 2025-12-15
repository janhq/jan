// Types
export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  model_path: string
  is_embedding: boolean
  api_key: string
  mmproj_path?: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

export interface DeviceInfo {
  id: string
  name: string
  memory: number
}

export interface GgufMetadata {
  version: number
  tensor_count: number
  metadata: Record<string, string>
}

// llama.cpp settings
export type LlamacppConfig = {
  version_backend: string
  auto_update_engine: boolean
  auto_unload: boolean
  timeout: number
  llamacpp_env: string
  memory_util: string
  chat_template: string
  n_gpu_layers: number
  offload_mmproj: boolean
  cpu_moe: boolean
  n_cpu_moe: number
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
  flash_attn: string
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

export type ModelPlan = {
  gpuLayers: number
  maxContextLength: number
  noOffloadKVCache: boolean
  offloadMmproj?: boolean
  batchSize: number
  mode: 'GPU' | 'Hybrid' | 'CPU' | 'Unsupported'
}

export interface DownloadItem {
  url: string
  save_path: string
  proxy?: Record<string, string | string[] | boolean>
  sha256?: string
  size?: number
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

export interface SystemMemory {
  totalVRAM: number
  totalRAM: number
  totalMemory: number
}

// backend types
export type BackendVersion = { version: string; backend: string }

export type BackendFeatures = {
  cuda11: boolean
  cuda12: boolean
  cuda13: boolean
  vulkan: boolean
}

export type SupportedFeatures = {
  avx: boolean
  avx2: boolean
  avx512: boolean
  cuda11: boolean
  cuda12: boolean
  cuda13: boolean
  vulkan: boolean
}
export type NvidiaInfo = {
  compute_capability: string
}

export type VulkanInfo = {
  api_version: string
}

export type GpuInfo = {
  driver_version: string
  nvidia_info?: NvidiaInfo | null
  vulkan_info?: VulkanInfo | null
}

export interface BestBackendResult {
  backend_string: string
  version: string
  backend_type: string
}

export interface UpdateCheckResult {
  update_needed: boolean
  new_version: string
  target_backend?: string
}

export interface SettingUpdateResult {
  backend_type_updated: boolean
  effective_backend_type?: string
  needs_backend_installation: boolean
  version?: string
  backend?: string
}
