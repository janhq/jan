/**
 * Platform Detection Utilities
 * Provides platform detection and feature checking functions
 */

import { Platform, PlatformFeature } from './types'

declare const IS_TAURI: boolean

/**
 * Check if running on Tauri (desktop)
 */
export const isPlatformTauri = (): boolean => {
  return typeof IS_TAURI !== 'undefined' && IS_TAURI === true
}

/**
 * Get current platform name
 */
export const getCurrentPlatform = (): Platform => {
  return isPlatformTauri() ? 'tauri' : 'web'
}

/**
 * Platform Features Configuration
 * Centralized feature flags for different platforms
 */
export const PlatformFeatures: Record<PlatformFeature, boolean> = {
  // Hardware monitoring and GPU usage
  [PlatformFeature.HARDWARE_MONITORING]: isPlatformTauri(),

  // Extension installation/management
  [PlatformFeature.EXTENSION_MANAGEMENT]: isPlatformTauri(),

  // MCP (Model Context Protocol) servers
  [PlatformFeature.MCP_SERVERS]: isPlatformTauri(),

  // Local API server
  [PlatformFeature.LOCAL_API_SERVER]: isPlatformTauri(),

  // Hub/model downloads
  [PlatformFeature.MODEL_HUB]: isPlatformTauri(),

  // System integrations (logs, file explorer, etc.)
  [PlatformFeature.SYSTEM_INTEGRATIONS]: isPlatformTauri(),

  // HTTPS proxy
  [PlatformFeature.HTTPS_PROXY]: isPlatformTauri(),
}

/**
 * Check if a specific feature is available on current platform
 */
export const isFeatureAvailable = (feature: PlatformFeature): boolean => {
  return PlatformFeatures[feature] || false
}

/**
 * Get unavailable feature message for current platform
 */
export const getUnavailableFeatureMessage = (
  feature: PlatformFeature
): string => {
  const platform = getCurrentPlatform()
  const featureName = feature
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .replace(/^./, (str) => str.toUpperCase())
  return `${featureName} is not available on ${platform} platform`
}
