import { invoke } from '@tauri-apps/api/core'
import {
  SessionInfo,
  DeviceInfo,
  UnloadResult,
  GgufMetadata,
  LlamacppConfig,
} from './types'

// Helpers
function asNumber(v: any, defaultValue = 0): number {
  if (v === '' || v === null || v === undefined) return defaultValue
  const n = Number(v)
  return isFinite(n) ? n : defaultValue
}

function asBool(v: any): boolean {
  if (v === '' || v === null || v === undefined) return false
  return v === true || v === 'true' || v === 1 || v === '1'
}

function asString(v: any, defaultValue = ''): string {
  if (v === '' || v === null || v === undefined) return defaultValue
  return String(v)
}

export function normalizeLlamacppConfig(config: any): LlamacppConfig {
  return {
    version_backend: asString(config.version_backend),
    auto_update_engine: asBool(config.auto_update_engine),
    auto_unload: asBool(config.auto_unload),
    timeout: asNumber(config.timeout, 600),

    llamacpp_env: asString(config.llamacpp_env),
    memory_util: asString(config.memory_util),
    chat_template: asString(config.chat_template),

    n_gpu_layers: asNumber(config.n_gpu_layers),
    offload_mmproj: asBool(config.offload_mmproj),
    cpu_moe: asBool(config.cpu_moe),
    n_cpu_moe: asNumber(config.n_cpu_moe),

    override_tensor_buffer_t: asString(config.override_tensor_buffer_t),

    ctx_size: asNumber(config.ctx_size),
    threads: asNumber(config.threads),
    threads_batch: asNumber(config.threads_batch),
    n_predict: asNumber(config.n_predict),
    batch_size: asNumber(config.batch_size),
    ubatch_size: asNumber(config.ubatch_size),

    device: asString(config.device),
    split_mode: asString(config.split_mode),
    main_gpu: asNumber(config.main_gpu),

    flash_attn: asString(config.flash_attn),
    cont_batching: asBool(config.cont_batching),

    no_mmap: asBool(config.no_mmap),
    mlock: asBool(config.mlock),
    no_kv_offload: asBool(config.no_kv_offload),

    cache_type_k: asString(config.cache_type_k),
    cache_type_v: asString(config.cache_type_v),

    defrag_thold: asNumber(config.defrag_thold, 0.0),

    rope_scaling: asString(config.rope_scaling),
    rope_scale: asNumber(config.rope_scale, 1.0),
    rope_freq_base: asNumber(config.rope_freq_base, 0.0),
    rope_freq_scale: asNumber(config.rope_freq_scale, 1.0),

    ctx_shift: asBool(config.ctx_shift),
  }
}

// LlamaCpp server commands
export async function loadLlamaModel(
  backendPath: string,
  modelId: string,
  modelPath: string,
  port: number,
  cfg: LlamacppConfig,
  envs: Record<string, string>,
  mmprojPath?: string,
  isEmbedding: boolean = false,
  timeout: number = 600
): Promise<SessionInfo> {
  const config = normalizeLlamacppConfig(cfg)
  return await invoke('plugin:llamacpp|load_llama_model', {
    backendPath,
    modelId,
    modelPath,
    port,
    config,
    envs,
    mmprojPath,
    isEmbedding,
    timeout,
  })
}

export async function unloadLlamaModel(pid: number): Promise<UnloadResult> {
  return await invoke('plugin:llamacpp|unload_llama_model', { pid })
}

export async function getDevices(
  backendPath: string,
  libraryPath?: string
): Promise<DeviceInfo[]> {
  return await invoke('plugin:llamacpp|get_devices', {
    backendPath,
    libraryPath,
  })
}

export async function generateApiKey(
  modelId: string,
  apiSecret: string
): Promise<string> {
  return await invoke('plugin:llamacpp|generate_api_key', {
    modelId,
    apiSecret,
  })
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  return await invoke('plugin:llamacpp|is_process_running', { pid })
}

export async function getRandomPort(): Promise<number> {
  return await invoke('plugin:llamacpp|get_random_port')
}

export async function findSessionByModel(
  modelId: string
): Promise<SessionInfo | null> {
  return await invoke('plugin:llamacpp|find_session_by_model', { modelId })
}

export async function getLoadedModels(): Promise<string[]> {
  return await invoke('plugin:llamacpp|get_loaded_models')
}

export async function getAllSessions(): Promise<SessionInfo[]> {
  return await invoke('plugin:llamacpp|get_all_sessions')
}

export async function getSessionByModel(
  modelId: string
): Promise<SessionInfo | null> {
  return await invoke('plugin:llamacpp|get_session_by_model', { modelId })
}

// GGUF commands
export async function readGgufMetadata(path: string): Promise<GgufMetadata> {
  return await invoke('plugin:llamacpp|read_gguf_metadata', { path })
}

export async function estimateKVCacheSize(
  meta: Record<string, string>,
  ctxSize?: number
): Promise<{ size: number; per_token_size: number }> {
  return await invoke('plugin:llamacpp|estimate_kv_cache_size', {
    meta,
    ctxSize,
  })
}

export async function getModelSize(path: string): Promise<number> {
  return await invoke('plugin:llamacpp|get_model_size', { path })
}

export async function isModelSupported(
  path: string,
  ctxSize?: number
): Promise<'RED' | 'YELLOW' | 'GREEN'> {
  return await invoke('plugin:llamacpp|is_model_supported', {
    path,
    ctxSize,
  })
}

export async function planModelLoadInternal(
  path: string,
  memoryMode: string,
  mmprojPath?: string,
  requestedContext?: number
): Promise<{
  gpuLayers: number
  maxContextLength: number
  noOffloadKVCache: boolean
  offloadMmproj?: boolean
  batchSize: number
  mode: 'GPU' | 'Hybrid' | 'CPU' | 'Unsupported'
}> {
  return await invoke('plugin:llamacpp|plan_model_load', {
    path,
    memoryMode,
    mmprojPath,
    requestedContext,
  })
}

// Cleanup commands
export async function cleanupLlamaProcesses(): Promise<void> {
  return await invoke('plugin:llamacpp|cleanup_llama_processes')
}

export * from './types'
