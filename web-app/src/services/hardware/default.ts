/**
 * Default Hardware Service - Generic implementation with minimal returns
 */

import type { HardwareData, SystemUsage, DeviceList, HardwareService } from './types'

export class DefaultHardwareService implements HardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    return null
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return null
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    return []
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    console.log('setActiveGpus called with data:', data)
    // No-op - not implemented in default service
  }
}
