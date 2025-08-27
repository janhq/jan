import { invoke } from '@tauri-apps/api/core'

// Types
export interface SessionInfo {
  pid: number;
  port: number;
  model_id: string;
  model_path: string;
  api_key: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  memory: number;
}

export interface GgufMetadata {
  version: number;
  tensor_count: number;
  metadata: Record<string, string>;
}

// Cleanup commands
export async function cleanupLlamaProcesses(): Promise<void> {
  return await invoke('plugin:llamacpp|cleanup_llama_processes');
}

// LlamaCpp server commands
export async function loadLlamaModel(
  backendPath: string,
  libraryPath?: string,
  args: string[] = []
): Promise<SessionInfo> {
  return await invoke('plugin:llamacpp|load_llama_model', {
    backendPath,
    libraryPath,
    args
  });
}

export async function unloadLlamaModel(pid: number): Promise<void> {
  return await invoke('plugin:llamacpp|unload_llama_model', { pid });
}

export async function getDevices(
  backendPath: string,
  libraryPath?: string
): Promise<DeviceInfo[]> {
  return await invoke('plugin:llamacpp|get_devices', {
    backendPath,
    libraryPath
  });
}

export async function generateApiKey(
  modelId: string,
  apiSecret: string
): Promise<string> {
  return await invoke('plugin:llamacpp|generate_api_key', {
    modelId,
    apiSecret
  });
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  return await invoke('plugin:llamacpp|is_process_running', { pid });
}

export async function getRandomPort(): Promise<number> {
  return await invoke('plugin:llamacpp|get_random_port');
}

export async function findSessionByModel(modelId: string): Promise<SessionInfo | null> {
  return await invoke('plugin:llamacpp|find_session_by_model', { modelId });
}

export async function getLoadedModels(): Promise<string[]> {
  return await invoke('plugin:llamacpp|get_loaded_models');
}

export async function getAllSessions(): Promise<SessionInfo[]> {
  return await invoke('plugin:llamacpp|get_all_sessions');
}

export async function getSessionByModel(modelId: string): Promise<SessionInfo | null> {
  return await invoke('plugin:llamacpp|get_session_by_model', { modelId });
}

// GGUF commands
export async function readGgufMetadata(path: string): Promise<GgufMetadata> {
  return await invoke('plugin:llamacpp|read_gguf_metadata', { path });
}
