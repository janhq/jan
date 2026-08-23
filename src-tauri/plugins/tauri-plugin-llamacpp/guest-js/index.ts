import { invoke } from '@tauri-apps/api/core'
import {
  SessionInfo,
  DeviceList,
  UnloadResult,
  ReloadReport,
  EngineInfo,
  GgufMetadata,
} from './types'

// Helpers
function asNumber(v: any, defaultValue = 0): number {
  if (v === '' || v === null || v === undefined) return defaultValue
  const n = Number(v)
  return isFinite(n) ? n : defaultValue
}

const I32_MAX = 2147483647
const I32_MIN = -2147483648

/**
 * Coerces to a value llama.cpp's int32 args accept, clamping rather than
 * overflowing. Exported because the extension needs the same clamp for
 * `timeout`, and a second hand-rolled one would drift.
 */
export function asI32(v: any, defaultValue = 0): number {
  const n = Math.trunc(asNumber(v, defaultValue))
  if (n > I32_MAX) return I32_MAX
  if (n < I32_MIN) return I32_MIN
  return n
}

export async function loadLlamaModel(
  modelId: string,
  isEmbedding: boolean = false
): Promise<SessionInfo> {
  return await invoke('plugin:llamacpp|load_llama_model', {
    modelId,
    isEmbedding,
  })
}

export async function unloadLlamaModel(modelId: string): Promise<UnloadResult> {
  return await invoke('plugin:llamacpp|unload_llama_model', { modelId })
}

export async function ensureSessionReady(
  modelId: string,
  isEmbedding: boolean = false
): Promise<SessionInfo> {
  return await invoke('plugin:llamacpp|ensure_session_ready', {
    modelId,
    isEmbedding,
  })
}

export async function getDevices(
  backendPath: string,
  envs: Record<string, string> = {}
): Promise<DeviceList[]> {
  return await invoke('plugin:llamacpp|get_devices', {
    backendPath,
    envs,
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

export async function findSessionByModel(
  modelId: string
): Promise<SessionInfo | null> {
  return await invoke('plugin:llamacpp|find_session_by_model', { modelId })
}

export async function getLoadedModels(): Promise<string[]> {
  return await invoke('plugin:llamacpp|get_loaded_models')
}

/**
 * Starts the supervised in-process engine worker. Replaces `startRouter`: no
 * downloaded backend binary, and the port is OS-assigned then reported back
 * rather than guessed.
 */
/**
 * `slotCacheMib` caps the directory holding each thread's KV cache, which lets
 * a conversation resume without re-reading its prompt. 0 turns that off; a
 * single saved conversation runs to hundreds of MiB, so it is a budget rather
 * than a boolean.
 */
export async function startEngine(
  presetPath: string,
  modelsMax: number,
  slotCacheMib: number = 0,
  envs: Record<string, string> = {}
): Promise<EngineInfo> {
  return await invoke('plugin:llamacpp|start_engine', {
    presetPath,
    modelsMax,
    slotCacheMib: asI32(slotCacheMib),
    envs,
  })
}

export async function stopEngine(): Promise<void> {
  return await invoke('plugin:llamacpp|stop_engine')
}

/** Null when no worker is running, including after one died. */
export async function getEngineInfo(): Promise<EngineInfo | null> {
  return await invoke('plugin:llamacpp|get_engine_info')
}

/**
 * The devices the shipped engine can offload to.
 *
 * Replaces the `getDevices(backendPath, envs)` shell-out to a downloaded
 * `llama-server --list-devices`: there is no downloaded binary any more, and
 * the engine is statically linked into the worker.
 */
export async function engineDevices(
  envs: Record<string, string> = {}
): Promise<DeviceList[]> {
  return await invoke('plugin:llamacpp|engine_devices', { envs })
}

/**
 * Applies a regenerated preset to the running worker without restarting it.
 *
 * `modelsMax` is optional; omitting it keeps the worker's current value. Unlike
 * the router, the worker can be resized, so the embedding slot bonus changing
 * no longer forces a cold restart.
 */
/**
 * Kills the worker without waiting for it to unwind. Backs the force-quit the
 * busy-on-exit dialog offers; use `stopEngine` everywhere else.
 */
export async function forceStopEngine(): Promise<void> {
  return await invoke('plugin:llamacpp|force_stop_engine')
}

/**
 * True when nothing is generating, so the model can be reconfigured or
 * unloaded. Omit `modelId` to ask about the whole worker.
 */
export async function engineSlotsIdle(modelId?: string): Promise<boolean> {
  return await invoke('plugin:llamacpp|engine_slots_idle', { modelId })
}

/**
 * Drops saved KV cache: a thread's (under every model it was used with), or a
 * whole model's. Returns how many were dropped; 0 when no worker is running,
 * which is not an error.
 */
export async function eraseThreadSlotState(args: {
  threadId?: string
  modelId?: string
}): Promise<number> {
  return await invoke('plugin:llamacpp|erase_thread_slot_state', {
    threadId: args.threadId,
    modelId: args.modelId,
  })
}

export async function reloadEngineModels(
  presetPath: string,
  modelsMax?: number,
  slotCacheMib?: number
): Promise<ReloadReport> {
  return await invoke('plugin:llamacpp|reload_engine_models', {
    presetPath,
    modelsMax,
    slotCacheMib:
      slotCacheMib === undefined ? undefined : asI32(slotCacheMib),
  })
}

// GGUF commands
export async function readGgufMetadata(path: string): Promise<GgufMetadata> {
  return await invoke('plugin:llamacpp|read_gguf_metadata', { path })
}

/**
 * Which of `names` exist as tensors in a gguf. Exact names, mirroring
 * llama.cpp's `gguf_find_tensor`: the facts worth knowing are yes/no ones
 * (`markov_w1.weight` marks a DSpark draft), and listing every tensor of a
 * large model to answer one would be far more data than the answer.
 */
export async function findGgufTensors(
  path: string,
  names: string[]
): Promise<string[]> {
  return await invoke('plugin:llamacpp|find_gguf_tensors', { path, names })
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

// Cleanup commands
export async function cleanupLlamaProcesses(): Promise<void> {
  return await invoke('plugin:llamacpp|cleanup_llama_processes')
}

export * from './types'
