import { fetchJsonWithAuth } from '@/lib/api-client'

declare const JAN_API_BASE_URL: string

export const profileService = {
  /**
   * Get user profile settings
   */
  getProfileSettings: async (): Promise<ProfileSettingsResponse> => {
    return fetchJsonWithAuth<ProfileSettingsResponse>(
      `${JAN_API_BASE_URL}v1/users/me/settings`
    )
  },

  /**
   * Update user profile settings
   */
  updateProfileSettings: async (
    data: UpdateProfileSettingsRequest
  ): Promise<ProfileSettingsResponse> => {
    return fetchJsonWithAuth<ProfileSettingsResponse>(
      `${JAN_API_BASE_URL}v1/users/me/settings`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  },

  /**
   * GetPreferences
   */
  getPreferences: async (): Promise<ProfileSettingsResponse> => {
    return fetchJsonWithAuth<ProfileSettingsResponse>(
      `${JAN_API_BASE_URL}v1//users/me/settings/preferences`
    )
  },

  /**
   * Update user preferences settings
   */
  updatePreferences: async (
    data: UpdateProfileSettingsRequest
  ): Promise<ProfileSettingsResponse> => {
    return fetchJsonWithAuth<ProfileSettingsResponse>(
      `${JAN_API_BASE_URL}v1/users/me/settings/preferences`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  },
}
