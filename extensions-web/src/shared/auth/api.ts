/**
 * Generic Authentication API Layer
 * Generic API calls for authentication (not provider-specific)
 */

import { AuthTokens } from './types'
import { AUTH_ENDPOINTS } from './const'

declare const JAN_BASE_URL: string

export interface UpgradeAccountRequest {
  username: string
  email: string
  full_name?: string
}

export interface UpgradeAccountResponse {
  status: string
}

export interface ApiKey {
  id: string
  name: string
  key?: string
  created_at: number
  last_used?: number
}

export interface CreateApiKeyRequest {
  name: string
}

export interface CreateApiKeyResponse {
  id: string
  name: string
  key: string
  created_at: number
}

export interface ListApiKeysResponse {
  api_keys: ApiKey[]
}

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
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
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
 * Sends refresh_token in request body
 */
export async function refreshToken(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(
    `${JAN_BASE_URL}${AUTH_ENDPOINTS.REFRESH_TOKEN}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }
  )

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<AuthTokens>
}

/**
 * Upgrade guest account to registered user
 */
export async function upgradeAccount(
  data: UpgradeAccountRequest,
  authHeader: { Authorization: string }
): Promise<UpgradeAccountResponse> {
  const response = await fetch(`${JAN_BASE_URL}${AUTH_ENDPOINTS.UPGRADE}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error(
      `Account upgrade failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<UpgradeAccountResponse>
}

/**
 * Create API key
 */
export async function createApiKey(
  data: CreateApiKeyRequest,
  authHeader: { Authorization: string }
): Promise<CreateApiKeyResponse> {
  const response = await fetch(`${JAN_BASE_URL}${AUTH_ENDPOINTS.API_KEYS}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error(
      `Create API key failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<CreateApiKeyResponse>
}

/**
 * List API keys
 */
export async function listApiKeys(
  authHeader: { Authorization: string }
): Promise<ListApiKeysResponse> {
  const response = await fetch(`${JAN_BASE_URL}${AUTH_ENDPOINTS.API_KEYS}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
  })

  if (!response.ok) {
    throw new Error(
      `List API keys failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<ListApiKeysResponse>
}

/**
 * Delete API key
 */
export async function deleteApiKey(
  keyId: string,
  authHeader: { Authorization: string }
): Promise<void> {
  const response = await fetch(`${JAN_BASE_URL}${AUTH_ENDPOINTS.API_KEYS}/${keyId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
  })

  if (!response.ok) {
    throw new Error(
      `Delete API key failed: ${response.status} ${response.statusText}`
    )
  }
}
