import { HardwareData, SystemUsage } from '@/hooks/useHardware'
import { isPlatformTauri } from '@/lib/platform'

// Only import Tauri for desktop version
let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined
if (isPlatformTauri()) {
  invoke = (await import('@tauri-apps/api/core')).invoke
}

// Device list interface for llamacpp extension
export interface DeviceList {
  id: string
  name: string
  mem: number
  free: number
  activated: boolean
}

/**
 * Get hardware information from the HardwareManagementExtension.
 * @returns {Promise<HardwareInfo>} A promise that resolves to the hardware information.
 */
export const getHardwareInfo = async (): Promise<HardwareData> => {
  if (isPlatformTauri() && invoke) {
    return invoke('plugin:hardware|get_system_info') as Promise<HardwareData>
  }
  
  // Web version: return mock hardware data
  return Promise.resolve({
    cpu: {
      arch: 'web',
      core_count: navigator.hardwareConcurrency || 4,
      extensions: [],
      name: 'Web Browser',
      usage: 0,
      instructions: []
    },
    gpus: [],
    os_type: 'web',
    os_name: navigator.userAgent.split('(')[1]?.split(';')[0] || 'Unknown',
    total_memory: 8 * 1024 * 1024 * 1024, // 8GB mock
    os: {
      name: 'Web',
      version: '1.0'
    },
    ram: {
      available: 4 * 1024 * 1024 * 1024, // 4GB mock
      total: 8 * 1024 * 1024 * 1024 // 8GB mock
    }
  } as HardwareData)
}

/**
 * Get system usage information from the HardwareManagementExtension.
 * @returns {Promise<SystemUsage>} A promise that resolves to the system usage information.
 */
export const getSystemUsage = async (): Promise<SystemUsage> => {
  if (isPlatformTauri() && invoke) {
    return invoke('plugin:hardware|get_system_usage') as Promise<SystemUsage>
  }
  
  // Web version: return mock system usage
  const totalMemory = 8 * 1024 * 1024 * 1024 // 8GB mock
  const usedMemory = Math.random() * totalMemory * 0.6 + totalMemory * 0.2 // 20-80% usage
  
  return Promise.resolve({
    cpu: Math.random() * 50, // Random CPU usage 0-50%
    used_memory: usedMemory,
    total_memory: totalMemory,
    gpus: [] // No GPUs in web version
  } as SystemUsage)
}

/**
 * Get devices from the llamacpp extension.
 * @returns {Promise<DeviceList[]>} A promise that resolves to the list of available devices.
 */
export const getLlamacppDevices = async (): Promise<DeviceList[]> => {
  if (isPlatformTauri()) {
    const extensionManager = window.core.extensionManager
    const llamacppExtension = extensionManager.getByName(
      '@janhq/llamacpp-extension'
    )

    if (!llamacppExtension) {
      throw new Error('llamacpp extension not found')
    }

    return llamacppExtension.getDevices()
  }
  
  // Web version: llamacpp not available
  return Promise.resolve([])
}

/**
 * Set gpus activate
 * @returns A Promise that resolves set gpus activate.
 */
export const setActiveGpus = async (data: { gpus: number[] }) => {
  // TODO: llama.cpp extension should handle this
  console.log(data)
}
