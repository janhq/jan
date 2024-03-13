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
