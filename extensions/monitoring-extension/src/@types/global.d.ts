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
