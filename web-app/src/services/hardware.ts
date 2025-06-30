import { HardwareData, SystemUsage } from '@/hooks/useHardware'
import { invoke } from '@tauri-apps/api/core'

/**
 * Get hardware information from the HardwareManagementExtension.
 * @returns {Promise<HardwareInfo>} A promise that resolves to the hardware information.
 */
export const getHardwareInfo = async () => {
  return invoke('get_system_info') as Promise<HardwareData>
}

/**
 * Get hardware information from the HardwareManagementExtension.
 * @returns {Promise<HardwareInfo>} A promise that resolves to the hardware information.
 */
export const getSystemUsage = async () => {
  return invoke('get_system_usage') as Promise<SystemUsage>
}

/**
 * Set gpus activate
 * @returns A Promise that resolves set gpus activate.
 */
export const setActiveGpus = async (data: { gpus: number[] }) => {
  // TODO: llama.cpp extension should handle this
  console.log(data)
}
