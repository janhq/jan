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

  // Local model inference (llama.cpp)
  [PlatformFeature.LOCAL_INFERENCE]: isPlatformTauri(),

  // MCP (Model Context Protocol) servers
  [PlatformFeature.MCP_SERVERS]: true,

  // Local API server
  [PlatformFeature.LOCAL_API_SERVER]: isPlatformTauri(),

  // Hub/model downloads
  [PlatformFeature.MODEL_HUB]: isPlatformTauri(),

  // System integrations (logs, file explorer, etc.)
  [PlatformFeature.SYSTEM_INTEGRATIONS]: isPlatformTauri(),

  // HTTPS proxy
  [PlatformFeature.HTTPS_PROXY]: isPlatformTauri(),
  
  // Default model providers (OpenAI, Anthropic, etc.) - disabled for web-only Jan builds
  [PlatformFeature.DEFAULT_PROVIDERS]: isPlatformTauri(),

  // Analytics and telemetry - disabled for web
  [PlatformFeature.ANALYTICS]: isPlatformTauri(),

  // Web-specific automatic model selection from jan provider - enabled for web only
  [PlatformFeature.WEB_AUTO_MODEL_SELECTION]: !isPlatformTauri(),

  // Model provider settings page management - disabled for web only
  [PlatformFeature.MODEL_PROVIDER_SETTINGS]: isPlatformTauri(),
}