export interface ResourceEvent {
  data: ResourceStatus
}

export interface ResourceStatus {
  mem: UsedMemInfo
  cpu: {
    usage: number
  }
  gpus: GpuInfo[]
}

export interface UsedMemInfo {
  total: number
  used: number
}

export interface GpuInfo {
  name: string | undefined
  vram: UsedMemInfo
}
