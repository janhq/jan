export interface ResourceEvent {
  data: ResourceStatus
}

export interface ResourceStatus {
  mem: UsedMemInfo
  cpu: {
    usage: number
  }
}

export interface UsedMemInfo {
  total: number
  used: number
}
