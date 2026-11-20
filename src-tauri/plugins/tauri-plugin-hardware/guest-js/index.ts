import { invoke } from '@tauri-apps/api/core'

// Types
export interface CpuStaticInfo {
  name: string;
  core_count: number;
  arch: string;
  extensions: string[];
}

export interface NvidiaInfo {
  index: number;
  compute_capability: string;
}

export interface VulkanInfo {
  index: number;
  device_type: string;
  api_version: string;
  device_id: number;
}

export interface GpuInfo {
  name: string;
  total_memory: number;
  vendor: string;
  uuid: string;
  driver_version: string;
  nvidia_info: NvidiaInfo | null;
  vulkan_info: VulkanInfo | null;
}

export interface SystemInfo {
  cpu: CpuStaticInfo;
  os_type: string;
  os_name: string;
  total_memory: number;
  gpus: GpuInfo[];
}

export interface GpuUsage {
  uuid: string;
  used_memory: number;
  total_memory: number;
}

export interface SystemUsage {
  cpu: number;
  used_memory: number;
  total_memory: number;
  gpus: GpuUsage[];
}

// Hardware commands
export async function getSystemInfo(): Promise<SystemInfo> {
  return await invoke('plugin:hardware|get_system_info');
}

export async function getSystemUsage(): Promise<SystemUsage> {
  return await invoke('plugin:hardware|get_system_usage');
}

/** Drops the cached detection so the next getSystemInfo() probes the GPUs again. */
export async function refreshSystemInfo(): Promise<void> {
  await invoke('plugin:hardware|refresh_system_info');
}
