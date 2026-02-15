import { invoke } from '@tauri-apps/api/core'
import { SessionInfo, UnloadResult, MlxConfig } from './types'

export { SessionInfo, UnloadResult, MlxConfig } from './types'

function asNumber(v: any, defaultValue = 0): number {
  if (v === '' || v === null || v === undefined) return defaultValue
  const n = Number(v)
  return isFinite(n) ? n : defaultValue
}

function asString(v: any, defaultValue = ''): string {
  if (v === '' || v === null || v === undefined) return defaultValue
  return String(v)
}

export function normalizeMlxConfig(config: any): MlxConfig {
  return {
    ctx_size: asNumber(config.ctx_size),
    n_predict: asNumber(config.n_predict),
    threads: asNumber(config.threads),
    chat_template: asString(config.chat_template),
    parallel: asNumber(config.parallel),
    batch_timeout_ms: asNumber(config.batch_timeout_ms),
    enable_continuous_batching: Boolean(config.enable_continuous_batching),
    kv_block_size: asNumber(config.kv_block_size),
    enable_prefix_caching: Boolean(config.enable_prefix_caching),
  }
}

export async function loadMlxModel(
  modelId: string,
  modelPath: string,
  port: number,
  cfg: MlxConfig,
  envs: Record<string, string>,
  isEmbedding: boolean = false,
  timeout: number = 600
): Promise<SessionInfo> {
  const config = normalizeMlxConfig(cfg)
  return await invoke('plugin:mlx|load_mlx_model', {
    modelId,
    modelPath,
    port,
    config,
    envs,
    isEmbedding,
    timeout,
  })
}

export async function unloadMlxModel(pid: number): Promise<UnloadResult> {
  return await invoke('plugin:mlx|unload_mlx_model', { pid })
}

export async function isMlxProcessRunning(pid: number): Promise<boolean> {
  return await invoke('plugin:mlx|is_mlx_process_running', { pid })
}

export async function getMlxRandomPort(): Promise<number> {
  return await invoke('plugin:mlx|get_mlx_random_port')
}

export async function findMlxSessionByModel(
  modelId: string
): Promise<SessionInfo | null> {
  return await invoke('plugin:mlx|find_mlx_session_by_model', { modelId })
}

export async function getMlxLoadedModels(): Promise<string[]> {
  return await invoke('plugin:mlx|get_mlx_loaded_models')
}

export async function getMlxAllSessions(): Promise<SessionInfo[]> {
  return await invoke('plugin:mlx|get_mlx_all_sessions')
}
