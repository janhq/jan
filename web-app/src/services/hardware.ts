import { HardwareData, SystemUsage } from '@/hooks/useHardware'
import { invoke } from '@tauri-apps/api/core'

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
 * Get devices from the llamacpp extension.
 * @returns {Promise<DeviceList[]>} A promise that resolves to the list of available devices.
 */
export const getLlamacppDevices = async (): Promise<DeviceList[]> => {
  const extensionManager = window.core.extensionManager
  const llamacppExtension = extensionManager.getByName(
    '@janhq/llamacpp-extension'
  )

  if (!llamacppExtension) {
    throw new Error('llamacpp extension not found')
  }

  return llamacppExtension.getDevices()
}

/**
 * Get recommended backend from the llamacpp extension.
 * @returns {Promise<string>} A promise that resolves to the recommended backend string.
 */
export const getRecommendedBackend = async (): Promise<string> => {
  const cacheKey = 'recommended_backend_cache'
  const cacheExpiryKey = 'recommended_backend_cache_expiry'
  const cacheExpiryTime = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  
  // Check if we have cached data that hasn't expired
  const cachedData = localStorage.getItem(cacheKey)
  const cacheExpiry = localStorage.getItem(cacheExpiryKey)
  
  if (cachedData && cacheExpiry) {
    const expiryTime = parseInt(cacheExpiry, 10)
    if (Date.now() < expiryTime) {
      return cachedData
    }
  }
  
  try {
    const extensionManager = window.core.extensionManager
    const llamacppExtension = extensionManager.getByName(
      '@janhq/llamacpp-extension'
    )

    if (!llamacppExtension) {
      throw new Error('llamacpp extension not found')
    }

    const backend = await llamacppExtension.getRecommendedBackend()
    
    // Cache the successful response
    localStorage.setItem(cacheKey, backend)
    localStorage.setItem(cacheExpiryKey, (Date.now() + cacheExpiryTime).toString())
    
    return backend
  } catch (error) {
    // If fetch fails and we have cached data (even expired), use it as fallback
    if (cachedData) {
      console.warn('Failed to get recommended backend, using cached data:', error)
      return cachedData
    }
    throw error
  }
}

/**
 * Set gpus activate
 * @returns A Promise that resolves set gpus activate.
 */
export const setActiveGpus = async (data: { gpus: number[] }) => {
  // TODO: llama.cpp extension should handle this
  console.log(data)
}
