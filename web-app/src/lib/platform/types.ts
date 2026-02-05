/**
 * Platform Types and Features
 * Defines all platform-specific types and feature enums
 */

/**
 * Supported platforms
 */
export type Platform = 'tauri' | 'web' | 'ios' | 'android'

/**
 * Platform Feature Enum
 * Defines all available features that can be platform-specific
 */
export enum PlatformFeature {
  // Hardware monitoring and GPU usage
  HARDWARE_MONITORING = 'hardwareMonitoring',

  SHORTCUT = 'shortcut',

  // Local model inference (llama.cpp)
  LOCAL_INFERENCE = 'localInference',

  // Local API server
  LOCAL_API_SERVER = 'localApiServer',

  // Hub/model downloads
  MODEL_HUB = 'modelHub',

  // System integrations (logs, file explorer, etc.)
  SYSTEM_INTEGRATIONS = 'systemIntegrations',

  // HTTPS proxy
  HTTPS_PROXY = 'httpsProxy',

  // Default model providers (OpenAI, Anthropic, etc.)
  DEFAULT_PROVIDERS = 'defaultProviders',
  // Projects management
  PROJECTS = 'projects',

  // Analytics and telemetry
  ANALYTICS = 'analytics',

  // Web-specific automatic model selection from jan provider
  WEB_AUTO_MODEL_SELECTION = 'webAutoModelSelection',

  // Model provider settings page management
  MODEL_PROVIDER_SETTINGS = 'modelProviderSettings',

  // Auto-enable MCP tool permissions without approval
  MCP_AUTO_APPROVE_TOOLS = 'mcpAutoApproveTools',

  // MCP servers settings page management
  MCP_SERVERS_SETTINGS = 'mcpServersSettings',

  // Extensions settings page management
  EXTENSIONS_SETTINGS = 'extensionsSettings',

  // Assistant functionality (creation, editing, management)
  ASSISTANTS = 'assistants',

  // Authentication (Google OAuth, user profiles)
  AUTHENTICATION = 'authentication',

  // Google Analytics tracking (web-only)
  GOOGLE_ANALYTICS = 'googleAnalytics',

  // Alternate keyboard shortcut bindings (web-only, to avoid browser conflicts)
  ALTERNATE_SHORTCUT_BINDINGS = 'alternateShortcutBindings',

  // First message persisted thread - web-only feature for storing first user message locally during thread creation
  FIRST_MESSAGE_PERSISTED_THREAD = 'firstMessagePersistedThread',

  // Temporary chat mode - web-only feature for ephemeral conversations like ChatGPT
  TEMPORARY_CHAT = 'temporaryChat',

  // File attachments/RAG UI and tooling (desktop-only for now)
  FILE_ATTACHMENTS = 'fileAttachments',
}
