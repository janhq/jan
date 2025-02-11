import { GpuAdditionalInformation } from '../hardware'

export type SystemResourceInfo = {
  memAvailable: number
}

export type GpuSetting = {
  gpus: GpuSettingInfo[]
  // TODO: This needs to be set based on user toggle in settings
  vulkan: boolean
  cpu?: any
}

export type GpuSettingInfo = {
  activated: boolean
  free_vram: number
  id: string
  name: string
  total_vram: number
  uuid: string
  version: string
  additional_information?: GpuAdditionalInformation
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
  totalMem: number
  freeMem: number
}

export type CpuCoreInfo = {
  model: string
  speed: number
}
