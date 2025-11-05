/**
 * Generic Authentication API Layer
 * Generic API calls for authentication (not provider-specific)
 */

import { AuthTokens } from './types'
import { AUTH_ENDPOINTS } from './const'

declare const JAN_BASE_URL: string

/**
 * Logout user on server
 */
export async function logoutUser(): Promise<void> {
  const response = await fetch(`${JAN_BASE_URL}${AUTH_ENDPOINTS.LOGOUT}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    console.warn(`Logout failed with status: ${response.status}`)
  }
}

/**
 * Guest login
 */
export async function guestLogin(): Promise<AuthTokens> {
  const response = await fetch(`${JAN_BASE_URL}${AUTH_ENDPOINTS.GUEST_LOGIN}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Guest login failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<AuthTokens>
}

/**
 * Refresh token (works for both guest and authenticated users)
 */
export async function refreshToken(): Promise<AuthTokens> {
  const response = await fetch(
    `${JAN_BASE_URL}${AUTH_ENDPOINTS.REFRESH_TOKEN}`,
    {
      method: 'GET',
      credentials: 'include',
    }
  )

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<AuthTokens>
}
