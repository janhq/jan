/**
 * User Settings Module
 * Exports user settings service and types
 */

export { JanUserSettingsService, getSharedUserSettingsService, userSettingsService } from './service'
export { getUserSettings, updateUserSettings } from './api'
export type {
  UserSettings,
  UpdateUserSettingsRequest,
  UserSettingsService,
  MemoryConfig,
  ProfileSettings,
  AdvancedSettings,
} from './types'
export {
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_PROFILE_SETTINGS,
  DEFAULT_ADVANCED_SETTINGS,
  DEFAULT_USER_SETTINGS,
} from './types'
