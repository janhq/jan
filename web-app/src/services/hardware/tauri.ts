/**
 * Tauri Hardware Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { HardwareData, SystemUsage, DeviceList } from './types'
import { DefaultHardwareService } from './default'
import { LOCAL_LLAMACPP_EXTENSION_NAME } from '@/lib/utils'

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    return invoke('plugin:hardware|get_system_info') as Promise<HardwareData>
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return invoke('plugin:hardware|get_system_usage') as Promise<SystemUsage>
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    // Use the OS-appropriate extension name instead of a hardcoded
    // '@janhq/llamacpp-extension'. On Windows and Linux the turboquant
    // `@janhq/llamacpp-extension` is excluded from the installer bundle
    // (see `package.json :: build:extensions:{win32,linux}` and ADRs
    // 2026-05-22 / 2026-05-28), so only `@janhq/llamacpp-upstream-extension`
    // is registered. Without this, the GPU panel showed the misleading
    // "llamacpp extension not found" error on Windows and Linux even when
    // the upstream extension was running and the backend was on GPU.
    const extensionManager = window.core.extensionManager
    const llamacppExtension = extensionManager.getByName(
      LOCAL_LLAMACPP_EXTENSION_NAME
    )

    if (!llamacppExtension) {
      throw new Error(
        `llama.cpp extension '${LOCAL_LLAMACPP_EXTENSION_NAME}' not found`
      )
    }

    return llamacppExtension.getDevices()
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    // TODO: llama.cpp extension should handle this
    console.log(data)
  }

  async refreshHardwareInfo(): Promise<void> {
    await invoke('plugin:hardware|refresh_system_info')
  }
}
