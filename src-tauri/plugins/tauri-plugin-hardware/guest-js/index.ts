import { invoke } from '@tauri-apps/api/core'

// Types
export interface CpuStaticInfo {
  name: string;
  core_count: number;
  arch: string;
  extensions: string[];
}

export interface GpuInfo {
  name: string;
  total_memory: number;
  vendor: string;
  uuid: string;
  driver_version: string;
  nvidia_info?: any;
  vulkan_info?: any;
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
