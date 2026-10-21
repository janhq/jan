import { invoke } from '@tauri-apps/api/core'
import {
  SessionInfo,
  LocalEngineConfig,
  UnloadResult,
  EngineAvailability,
} from './types'

export { SessionInfo, LocalEngineConfig, UnloadResult, EngineAvailability } from './types'

function asNumber(value: unknown, fallback = 0): number {
  if (value === '' || value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeLocalEngineConfig(config?: Partial<LocalEngineConfig>): LocalEngineConfig {
  return {
    ctx_size: asNumber(config?.ctx_size),
    threads: asNumber(config?.threads),
    ...(config?.api_key ? { api_key: config.api_key } : {}),
  }
}

/**
 * Starts the engine sidecar for a model and waits until it answers.
 */
export async function loadLocalModel(
  engine: string,
  modelId: string,
  modelPath: string,
  port: number,
  config?: Partial<LocalEngineConfig>,
  timeout: number = 600,
  dataFolder?: string
): Promise<SessionInfo> {
  return await invoke('plugin:local-engine|load_local_model', {
    engine,
    modelId,
    modelPath,
    port,
    config: normalizeLocalEngineConfig(config),
    timeout,
    dataFolder,
  })
}

/**
 * Stops the sidecar for a session.
 */
export async function unloadLocalModel(pid: number): Promise<UnloadResult> {
  return await invoke('plugin:local-engine|unload_local_model', { pid })
}

export async function isLocalEngineProcessRunning(pid: number): Promise<boolean> {
  return await invoke('plugin:local-engine|is_local_engine_process_running', { pid })
}

export async function getLocalEngineRandomPort(): Promise<number> {
  return await invoke('plugin:local-engine|get_local_engine_random_port')
}

export async function findLocalSessionByModel(
  modelId: string
): Promise<SessionInfo | null> {
  return await invoke('plugin:local-engine|find_local_session_by_model', { modelId })
}

export async function getLocalLoadedModels(): Promise<string[]> {
  return await invoke('plugin:local-engine|get_local_loaded_models')
}

export async function getLocalAllSessions(): Promise<SessionInfo[]> {
  return await invoke('plugin:local-engine|get_local_all_sessions')
}

/**
 * Reports whether the engine's runtime is installed and usable here.
 */
export async function checkLocalEngine(
  engine: string,
  dataFolder?: string
): Promise<EngineAvailability> {
  return await invoke('plugin:local-engine|check_local_engine', { engine, dataFolder })
}

/**
 * Installs the engine's runtime into a virtualenv Jan manages.
 *
 * Resolves with the path of the interpreter that was set up.
 */
export async function installLocalEngineRuntime(
  engine: string,
  dataFolder?: string
): Promise<string> {
  return await invoke('plugin:local-engine|install_local_engine_runtime', {
    engine,
    dataFolder,
  })
}

export async function cleanupLocalEngineProcesses(): Promise<void> {
  await invoke('plugin:local-engine|cleanup_local_engine_processes')
}
