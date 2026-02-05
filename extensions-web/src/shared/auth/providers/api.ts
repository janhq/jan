/**
 * Provider-specific API Layer
 * API calls specific to authentication providers
 */

import { AuthTokens, LoginUrlResponse } from './types'

declare const JAN_BASE_URL: string

export async function getLoginUrl(endpoint: string): Promise<LoginUrlResponse> {
  const response: Response = await fetch(`${JAN_BASE_URL}${endpoint}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to get login URL: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<LoginUrlResponse>
}

export async function handleOAuthCallback(
  endpoint: string,
  code: string,
  state?: string
): Promise<AuthTokens> {
  const response: Response = await fetch(`${JAN_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ code, state }),
  })

  if (!response.ok) {
    throw new Error(
      `OAuth callback failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<AuthTokens>
}
