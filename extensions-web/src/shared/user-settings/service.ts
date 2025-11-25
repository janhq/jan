/**
 * User Settings Service
 * Handles user settings management via Jan API
 */

import { getSharedAuthService } from '../auth'
import { getUserSettings, updateUserSettings } from './api'
import type {
  UserSettings,
  UpdateUserSettingsRequest,
  UserSettingsService,
} from './types'

export class JanUserSettingsService implements UserSettingsService {
  private static instance: JanUserSettingsService | null = null
  private authService = getSharedAuthService()
  private cachedSettings: UserSettings | null = null

  private constructor() {}

  static getInstance(): JanUserSettingsService {
    if (!JanUserSettingsService.instance) {
      JanUserSettingsService.instance = new JanUserSettingsService()
    }
    return JanUserSettingsService.instance
  }

  /**
   * Get current user's settings
   * Returns cached settings if available, otherwise fetches from server
   */
  async getUserSettings(forceRefresh = false): Promise<UserSettings> {
    if (this.cachedSettings && !forceRefresh) {
      return this.cachedSettings
    }

    const authHeader = await this.authService.getAuthHeader()
    this.cachedSettings = await getUserSettings(authHeader)
    return this.cachedSettings
  }

  /**
   * Update user settings
   * Partial update - only provided fields are updated
   */
  async updateUserSettings(
    request: UpdateUserSettingsRequest
  ): Promise<UserSettings> {
    const authHeader = await this.authService.getAuthHeader()
    this.cachedSettings = await updateUserSettings(request, authHeader)
    return this.cachedSettings
  }

  /**
   * Clear cached settings
   */
  clearCache(): void {
    this.cachedSettings = null
  }
}

// Singleton instance
let sharedUserSettingsService: JanUserSettingsService | null = null

/**
 * Get or create the shared JanUserSettingsService instance
 */
export function getSharedUserSettingsService(): JanUserSettingsService {
  if (!sharedUserSettingsService) {
    sharedUserSettingsService = JanUserSettingsService.getInstance()
  }
  return sharedUserSettingsService
}

// Export for direct access
export const userSettingsService = getSharedUserSettingsService()
