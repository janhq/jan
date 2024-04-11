export type SystemResourceInfo = {
  numCpuPhysicalCore: number
  memAvailable: number
}

export type RunMode = 'cpu' | 'gpu'

export type GpuSetting = {
  notify: boolean
  run_mode: RunMode
  nvidia_driver: {
    exist: boolean
    version: string
  }
  cuda: {
    exist: boolean
    version: string
  }
  gpus: GpuSettingInfo[]
  gpu_highest_vram: string
  gpus_in_use: string[]
  is_initial: boolean
  // TODO: This needs to be set based on user toggle in settings
  vulkan: boolean
}

export type GpuSettingInfo = {
  id: string
  vram: string
  name: string
  arch?: string
}

export type SystemInformation = {
  gpuSetting?: GpuSetting
  osInfo?: OperatingSystemInfo
}

export const SupportedPlatforms = ['win32', 'linux', 'darwin'] as const
export type SupportedPlatformTuple = typeof SupportedPlatforms
export type SupportedPlatform = SupportedPlatformTuple[number]

export type OperatingSystemInfo = {
  platform: SupportedPlatform | 'unknown'
  arch: string
  release: string
  machine: string
  version: string
  totalMem: number
  freeMem: number
}

export type CpuCoreInfo = {
  model: string
  speed: number
}
