/**
 * Platform Types and Features
 * Defines all platform-specific types and feature enums
 */

/**
 * Supported platforms
 */
export type Platform = 'tauri' | 'web'

/**
 * Platform Feature Enum
 * Defines all available features that can be platform-specific
 */
export enum PlatformFeature {
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

  // System integrations (logs, file explorer, etc.)
  SYSTEM_INTEGRATIONS = 'systemIntegrations',

  // HTTPS proxy
  HTTPS_PROXY = 'httpsProxy',
}
