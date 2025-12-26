interface User {
  id: string
  name: string
  email: string
  avatar?: string
  pro?: boolean
}

interface MemoryConfig {
  enabled: boolean
  observe_enabled: boolean
  inject_user_core: boolean
  inject_semantic: boolean
  inject_episodic: boolean
  max_user_items: number
  max_project_items: number
  max_episodic_items: number
  min_similarity: number
}

interface ProfileSettings {
  base_style: string
  custom_instructions: string
  nick_name: string
  occupation: string
  more_about_you: string
}

interface AdvancedSettings {
  web_search: boolean
  code_enabled: boolean
}

interface ServerCapabilities {
  image_generation_enabled: boolean
}

interface ProfileSettingsResponse {
  id: number
  user_id: number
  memory_config: MemoryConfig
  profile_settings: ProfileSettings
  advanced_settings: AdvancedSettings
  enable_trace: boolean
  enable_tools: boolean
  preferences: Preferences
  server_capabilities?: ServerCapabilities
  created_at: string
  updated_at: string
}

interface UpdateProfileSettingsRequest {
  memory_config?: Partial<MemoryConfig>
  profile_settings?: Partial<ProfileSettings>
  advanced_settings?: Partial<AdvancedSettings>
  enable_trace?: boolean
  enable_tools?: boolean
  preferences?: Partial<Preferences>
}

interface Preferences {
  enable_browser: boolean
  enable_deep_research: boolean
  enable_search: boolean
  enable_thinking: boolean
  enable_image_generation: boolean
  selected_model: string
}
