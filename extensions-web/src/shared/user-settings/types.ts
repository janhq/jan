/**
 * User Settings Types
 * Based on user-settings-api.md specification
 */

/**
 * Memory Configuration
 * All memory-related settings grouped in one object
 */
export interface MemoryConfig {
  enabled: boolean // Master toggle for all memory features
  observe_enabled: boolean // Automatically observe and learn from conversations
  inject_user_core: boolean // Include user core facts in memory injection
  inject_semantic: boolean // Include semantic project facts in memory injection
  inject_episodic: boolean // Include episodic conversation history in memory injection
  max_user_items: number // Maximum user memory items to retrieve (0-20)
  max_project_items: number // Maximum project facts to retrieve (0-50)
  max_episodic_items: number // Maximum episodic events to retrieve (0-20)
  min_similarity: number // Minimum relevance score for memory retrieval (0.0-1.0)
}

/**
 * Profile Settings
 * User profile information
 */
export interface ProfileSettings {
  custom_instructions: string // Additional behavior, style, and tone preferences for the AI
  nickname: string // What should Jan call you?
  occupation: string // Your occupation or role
  more_about_you: string // Additional information about yourself
  base_style?: string // Base style and tone (e.g., Default, Concise, etc.)
}

/**
 * Advanced Settings
 * Advanced feature toggles
 */
export interface AdvancedSettings {
  web_search: boolean // Let Jan automatically search the web for answers
  code_enabled: boolean // Enable code execution features
}

/**
 * User Settings
 * Complete user settings object
 */
export interface UserSettings {
  id: number
  user_id: number
  memory_config: MemoryConfig
  profile_settings: ProfileSettings
  advanced_settings: AdvancedSettings
  enable_trace: boolean // Enable OpenTelemetry tracing for requests
  enable_tools: boolean // Enable MCP tools and function calling
  preferences: Record<string, any> // Flexible JSON for future extensions
  created_at: string
  updated_at: string
}

/**
 * Update User Settings Request
 * Partial update - only provided fields are updated
 */
export interface UpdateUserSettingsRequest {
  memory_config?: Partial<MemoryConfig>
  profile_settings?: Partial<ProfileSettings>
  advanced_settings?: Partial<AdvancedSettings>
  enable_trace?: boolean
  enable_tools?: boolean
  preferences?: Record<string, any>
}

/**
 * User Settings Service Interface
 */
export interface UserSettingsService {
  /**
   * Get current user's settings
   * If no settings exist, returns defaults
   */
  getUserSettings(): Promise<UserSettings>

  /**
   * Update user settings
   * Partial update - only provided fields are updated
   */
  updateUserSettings(request: UpdateUserSettingsRequest): Promise<UserSettings>
}

/**
 * Default values for user settings
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  observe_enabled: true,
  inject_user_core: true,
  inject_semantic: true,
  inject_episodic: false,
  max_user_items: 3,
  max_project_items: 5,
  max_episodic_items: 3,
  min_similarity: 0.75,
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  custom_instructions: '',
  nickname: '',
  occupation: '',
  more_about_you: '',
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  web_search: false,
  code_enabled: false,
}

export const DEFAULT_USER_SETTINGS: Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  memory_config: DEFAULT_MEMORY_CONFIG,
  profile_settings: {
    ...DEFAULT_PROFILE_SETTINGS,
    base_style: 'Default',
  },
  advanced_settings: DEFAULT_ADVANCED_SETTINGS,
  enable_trace: false,
  enable_tools: true,
  preferences: {},
}
