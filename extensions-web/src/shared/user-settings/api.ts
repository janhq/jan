/**
 * User Settings API
 * API calls for user settings management
 */

import type { UserSettings, UpdateUserSettingsRequest } from './types'

declare const JAN_BASE_URL: string

const USER_SETTINGS_ENDPOINT = '/v1/users/me/settings'

/**
 * Get current user's settings
 */
export async function getUserSettings(
  authHeader: { Authorization: string }
): Promise<UserSettings> {
  const url = `${JAN_BASE_URL}${USER_SETTINGS_ENDPOINT}`
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      errorData.message || `Failed to get user settings: ${response.statusText}`
    )
  }

  return response.json()
}

/**
 * Update user settings
 * Partial update - only provided fields are updated
 */
export async function updateUserSettings(
  request: UpdateUserSettingsRequest,
  authHeader: { Authorization: string }
): Promise<UserSettings> {
  const url = `${JAN_BASE_URL}${USER_SETTINGS_ENDPOINT}`
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      errorData.message || `Failed to update user settings: ${response.statusText}`
    )
  }

  return response.json()
}
