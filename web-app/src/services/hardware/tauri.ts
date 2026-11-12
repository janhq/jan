/**
 * Tauri Hardware Service - Desktop implementation
 */

import {
  getSystemInfo,
  getSystemUsage,
  refreshSystemInfo,
} from '@janhq/tauri-plugin-hardware-api'
import { ServiceKeys } from '@janhq/core'
import { getExtensionHost } from '@/lib/extensions/host'
import type { HardwareData, SystemUsage, DeviceList } from './types'
import { DefaultHardwareService } from './default'

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    const info = await getSystemInfo()
    // The plugin reports static facts only; `usage` is the app's live reading,
    // filled in later from getSystemUsage().
    return { ...info, cpu: { ...info.cpu, usage: 0 } }
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return getSystemUsage()
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    const llamacpp = getExtensionHost().services.get(ServiceKeys.Llamacpp)
    if (!llamacpp) {
      throw new Error('llamacpp extension not found')
    }
    return llamacpp.getDevices()
  }

  async reconcileLlamacppDevices(): Promise<'unchanged' | 'restarted' | 'busy'> {
    const llamacpp = getExtensionHost().services.get(ServiceKeys.Llamacpp)
    if (!llamacpp) return 'unchanged'
    return llamacpp.reconcileEngineDevices()
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    // TODO: llama.cpp extension should handle this
    console.log(data)
  }

  async refreshHardwareInfo(): Promise<void> {
    await refreshSystemInfo()
  }
}
