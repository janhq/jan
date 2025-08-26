/**
 * Web Hardware Service - Web implementation
 */

import type { HardwareData, SystemUsage, DeviceList, HardwareService } from './types'

export class WebHardwareService implements HardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    console.log('Hardware info not available in web mode')
    return null
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    console.log('System usage not available in web mode')
    return null
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    console.log('GPU devices not available in web mode')
    return []
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    console.log('GPU activation not available in web mode:', data)
  }
}