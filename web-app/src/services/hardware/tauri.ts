/**
 * Tauri Hardware Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { HardwareData, SystemUsage, DeviceList } from './types'
import { DefaultHardwareService } from './default'

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    try {
      return invoke('plugin:hardware|get_system_info') as Promise<HardwareData>
    } catch (error) {
      console.error('Error getting hardware info in Tauri, falling back to default:', error)
      return super.getHardwareInfo()
    }
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    try {
      return invoke('plugin:hardware|get_system_usage') as Promise<SystemUsage>
    } catch (error) {
      console.error('Error getting system usage in Tauri, falling back to default:', error)
      return super.getSystemUsage()
    }
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    try {
      const extensionManager = window.core.extensionManager
      const llamacppExtension = extensionManager.getByName('@janhq/llamacpp-extension')

      if (!llamacppExtension) {
        throw new Error('llamacpp extension not found')
      }

      return llamacppExtension.getDevices()
    } catch (error) {
      console.error('Error getting llamacpp devices in Tauri, falling back to default:', error)
      return super.getLlamacppDevices()
    }
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    try {
      // TODO: llama.cpp extension should handle this
      console.log(data)
    } catch (error) {
      console.error('Error setting active GPUs in Tauri, falling back to default:', error)
      return super.setActiveGpus(data)
    }
  }
}