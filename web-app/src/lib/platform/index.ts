/**
 * Platform Detection and Utilities
 * Provides platform-aware functionality for Jan app
 */

declare const IS_TAURI: boolean
declare const IS_WEB: boolean

/**
 * Check if running on Tauri (desktop)
 */
export const isPlatformTauri = (): boolean => {
  return typeof IS_TAURI !== 'undefined' && IS_TAURI === true
}

/**
 * Check if running on Web
 */
export const isPlatformWeb = (): boolean => {
  return typeof IS_WEB !== 'undefined' && IS_WEB === true
}

/**
 * Get current platform name
 */
export const getCurrentPlatform = (): 'tauri' | 'web' | 'unknown' => {
  if (isPlatformTauri()) return 'tauri'
  if (isPlatformWeb()) return 'web'
  return 'unknown'
}

/**
 * Platform Feature Enum
 * Defines all available features that can be platform-specific
 */
export enum PlatformFeature {
  // File system operations
  FILE_SYSTEM = 'fileSystem',
  
  // Local model inference (llama.cpp)
  LOCAL_INFERENCE = 'localInference',
  
  // Hardware monitoring and GPU usage
  HARDWARE_MONITORING = 'hardwareMonitoring',
  
  // Extension installation/management
  EXTENSION_MANAGEMENT = 'extensionManagement',
  
  // MCP (Model Context Protocol) servers
  MCP_SERVERS = 'mcpServers',
  
  // Local API server
  LOCAL_API_SERVER = 'localApiServer',
  
  // Hub/model downloads
  MODEL_HUB = 'modelHub',
  
  // System integrations (notifications, file explorer, etc.)
  SYSTEM_INTEGRATIONS = 'systemIntegrations',
  
  // HTTPS proxy
  HTTPS_PROXY = 'httpsProxy',
  
  // Desktop-specific UI features
  WINDOW_CONTROLS = 'windowControls',
  SYSTEM_TRAY = 'systemTray',
  ALPHA_TRANSPARENCY = 'alphaTransparency',
  
  // Web-specific features
  PWA = 'pwa',
  BROWSER_STORAGE = 'browserStorage',
}

/**
 * Platform Features Configuration
 * Centralized feature flags for different platforms
 */
export const PlatformFeatures: Record<PlatformFeature, boolean> = {
  // File system operations
  [PlatformFeature.FILE_SYSTEM]: isPlatformTauri(),
  
  // Local model inference (llama.cpp)
  [PlatformFeature.LOCAL_INFERENCE]: isPlatformTauri(),
  
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
  
  // System integrations (notifications, file explorer, etc.)
  [PlatformFeature.SYSTEM_INTEGRATIONS]: isPlatformTauri(),
  
  // HTTPS proxy
  [PlatformFeature.HTTPS_PROXY]: isPlatformTauri(),
  
  // Desktop-specific UI features
  [PlatformFeature.WINDOW_CONTROLS]: isPlatformTauri(),
  [PlatformFeature.SYSTEM_TRAY]: isPlatformTauri(),
  [PlatformFeature.ALPHA_TRANSPARENCY]: isPlatformTauri(),
  
  // Web-specific features
  [PlatformFeature.PWA]: isPlatformWeb(),
  [PlatformFeature.BROWSER_STORAGE]: isPlatformWeb(),
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
export const getUnavailableFeatureMessage = (feature: PlatformFeature): string => {
  const platform = getCurrentPlatform()
  const featureName = feature.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, str => str.toUpperCase())
  return `${featureName} is not available on ${platform} platform`
}

// Re-export everything from platform-specific adapters and managers
export * from './adapters/web/api.adapter'
export * from './extension-manager'