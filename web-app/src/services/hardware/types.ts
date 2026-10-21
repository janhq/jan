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
  /**
   * Restarts the llama.cpp engine when the machine now offers different devices
   * than the running engine started with. 'busy' means a model is loading or
   * generating, so nothing was touched.
   */
  reconcileLlamacppDevices(): Promise<'unchanged' | 'restarted' | 'busy'>
  setActiveGpus(data: { gpus: number[] }): Promise<void>
  /** Invalidates cached GPU detection so next getHardwareInfo() re-detects. Use after system resume (e.g. Linux sleep). */
  refreshHardwareInfo(): Promise<void>
}

// Re-export hardware types for convenience
export type { HardwareData, SystemUsage }
