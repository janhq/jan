/**
 * Hardware Service Types
 */

import type { HardwareData, SystemUsage } from '@/hooks/useHardware'

// Device list interface for llamacpp extension
export interface DeviceList {
  id: string
  name: string
  mem: number
  free: number
  activated: boolean
}

export interface HardwareService {
  getHardwareInfo(): Promise<HardwareData | null>
  getSystemUsage(): Promise<SystemUsage | null>
  getLlamacppDevices(): Promise<DeviceList[]>
  setActiveGpus(data: { gpus: number[] }): Promise<void>
}

// Re-export hardware types for convenience
export type { HardwareData, SystemUsage }
