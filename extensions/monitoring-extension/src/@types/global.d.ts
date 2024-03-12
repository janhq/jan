declare const NODE: string

type CpuGpuInfo = {
  cpu: {
    usage: number
  }
  gpu: GpuInfo[]
}

type GpuInfo = {
  id: string
  name: string
  temperature: string
  utilization: string
  memoryTotal: string
  memoryFree: string
  memoryUtilization: string
}

/**
 * Default GPU settings
 * TODO: This needs to be refactored to support multiple accelerators
 **/
const DEFAULT_SETTINGS: GpuSetting = {
  notify: true,
  run_mode: 'cpu',
  nvidia_driver: {
    exist: false,
    version: '',
  },
  cuda: {
    exist: false,
    version: '',
  },
  gpus: [],
  gpu_highest_vram: '',
  gpus_in_use: [],
  is_initial: true,
  // TODO: This needs to be set based on user toggle in settings
  vulkan: false,
}
