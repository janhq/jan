/**
 * Provider-specific API Layer
 * API calls specific to authentication providers
 */

import { AuthTokens, LoginUrlResponse } from './types'

declare const JAN_BASE_URL: string

/**
 * Extract tokens from URL fragment
 * Backend redirects with tokens in fragment: #access_token=...&refresh_token=...
 */
function extractTokensFromFragment(): AuthTokens | null {
  try {
    const hash = window.location.hash.substring(1)
    if (!hash) return null

    const params = new URLSearchParams(hash)
    const access_token = params.get('access_token')

    if (!access_token) return null

    return {
      access_token,
      refresh_token: params.get('refresh_token') || undefined,
      expires_in: params.get('expires_in') ? parseInt(params.get('expires_in')!) : undefined,
      expires_at: params.get('expires_at') || undefined,
      object: 'token',
    }
  } catch (error) {
    console.error('Failed to extract tokens from URL fragment:', error)
    return null
  }
}

export async function getLoginUrl(endpoint: string, redirectUrl?: string): Promise<LoginUrlResponse> {
  const url = new URL(`${JAN_BASE_URL}${endpoint}`)
  if (redirectUrl) {
    url.searchParams.set('redirect_url', redirectUrl)
  }

  const response: Response = await fetch(url.toString(), {
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
  // First, check if tokens are in URL fragment (PKCE flow)
  // Backend redirects to frontend with tokens in fragment: #access_token=...&refresh_token=...
  const tokensFromFragment = extractTokensFromFragment()
  
  if (tokensFromFragment) {
    console.debug('[Auth] Tokens extracted from URL fragment (PKCE flow)')
    
    // Clear hash from URL for security
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    
    return tokensFromFragment
  }

  // Fallback: Traditional flow with POST request (for backward compatibility)
  // This handles the case where backend returns tokens via JSON response
  console.debug('[Auth] No tokens in fragment, attempting POST callback')
  
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
