export type Cpu = {
  arch: string
  cores: number
  instructions: string[]
  model: string
  usage: number
}

export type GpuAdditionalInformation = {
  compute_cap: string
  driver_version: string
}

export type Gpu = {
  activated: boolean
  additional_information?: GpuAdditionalInformation
  free_vram: number
  id: string
  name: string
  total_vram: number
  uuid: string
  version: string
}

export type Os = {
  name: string
  version: string
}

export type Power = {
  battery_life: number
  charging_status: string
  is_power_saving: boolean
}

export type Ram = {
  available: number
  total: number
  type: string
}

export type Storage = {
  available: number
  total: number
  type: string
}

export type HardwareInformation = {
  cpu: Cpu
  gpus: Gpu[]
  os: Os
  power: Power
  ram: Ram
  storage: Storage
}
