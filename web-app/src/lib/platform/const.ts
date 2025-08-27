/**
 * Platform Feature Configuration
 * Centralized feature flags for different platforms
 */

import { PlatformFeature } from './types'
import { isPlatformTauri } from './utils'

/**
 * Platform Features Configuration
 * Centralized feature flags for different platforms
 */
export const PlatformFeatures: Record<PlatformFeature, boolean> = {
  // Hardware monitoring and GPU usage
  [PlatformFeature.HARDWARE_MONITORING]: isPlatformTauri(),

  // Extension installation/management
  [PlatformFeature.EXTENSION_MANAGEMENT]: true,

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