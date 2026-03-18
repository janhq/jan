import { invoke } from '@tauri-apps/api/core'
import { SessionInfo, UnloadResult } from './types'

export { SessionInfo, UnloadResult } from './types'

export async function loadFoundationModelsServer(
  modelId: string,
  port: number,
  apiKey: string,
  timeout: number = 60
): Promise<SessionInfo> {
  return await invoke('plugin:foundation-models|load_foundation_models_server', {
    modelId,
    port,
    apiKey,
    timeout,
  })
}

export async function unloadFoundationModelsServer(
  pid: number
): Promise<UnloadResult> {
  return await invoke('plugin:foundation-models|unload_foundation_models_server', { pid })
}

export async function isFoundationModelsProcessRunning(
  pid: number
): Promise<boolean> {
  return await invoke('plugin:foundation-models|is_foundation_models_process_running', { pid })
}

export async function getFoundationModelsRandomPort(): Promise<number> {
  return await invoke('plugin:foundation-models|get_foundation_models_random_port')
}

export async function findFoundationModelsSession(): Promise<SessionInfo | null> {
  return await invoke('plugin:foundation-models|find_foundation_models_session')
}

export async function isFoundationModelsLoaded(): Promise<boolean> {
  return await invoke('plugin:foundation-models|get_foundation_models_loaded')
}

export async function getAllFoundationModelsSessions(): Promise<SessionInfo[]> {
  return await invoke('plugin:foundation-models|get_foundation_models_all_sessions')
}

export async function cleanupFoundationModelsProcesses(): Promise<void> {
  return await invoke('plugin:foundation-models|cleanup_foundation_models_processes')
}

/**
 * Run `foundation-models-server --check` and return a machine-readable
 * availability token. Possible values:
 *   - `"available"`                  — device is eligible and ready
 *   - `"notEligible"`                — device does not support Apple Intelligence
 *   - `"appleIntelligenceNotEnabled"` — Apple Intelligence disabled in Settings
 *   - `"modelNotReady"`              — model is still downloading
 *   - `"unavailable"`                — other unavailability reason
 *   - `"binaryNotFound"`             — server binary was not bundled (non-macOS build)
 */
export async function checkFoundationModelsAvailability(): Promise<string> {
  return await invoke('plugin:foundation-models|check_foundation_models_availability')
}
