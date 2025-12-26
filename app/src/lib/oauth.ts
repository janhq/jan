/**
 * OAuth 2.0 PKCE (Proof Key for Code Exchange) utilities for Keycloak integration
 */

import { LOCAL_STORAGE_KEY } from '@/constants'

declare const VITE_AUTH_URL: string
declare const VITE_AUTH_REALM: string
declare const VITE_AUTH_CLIENT_ID: string
declare const VITE_OAUTH_REDIRECT_URI: string

/**
 * Generate a cryptographically secure random string for OAuth state/verifier
 */
function generateRandomString(length: number): string {
  const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)
  return Array.from(randomValues)
    .map((val) => charset[val % charset.length])
    .join('')
}

/**
 * Generate SHA-256 hash of the code verifier for PKCE challenge
 */
async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return crypto.subtle.digest('SHA-256', data)
}

/**
 * Base64-URL encode the hash
 */
function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Generate PKCE code verifier and challenge
 */
export async function generatePKCE() {
  const codeVerifier = generateRandomString(128)
  const hashed = await sha256(codeVerifier)
  const codeChallenge = base64URLEncode(hashed)
  return { codeVerifier, codeChallenge }
}

/**
 * Generate OAuth state parameter
 */
export function generateState(): string {
  return generateRandomString(32)
}

/**
 * Encode OAuth data into the state parameter (iOS Safari compatible)
 * This ensures state survives even if localStorage is cleared
 */
function encodeOAuthData(data: {
  state: string
  codeVerifier: string
  redirectUrl?: string
}): string {
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  return base64URLEncode(bytes.buffer)
}

/**
 * Decode OAuth data from the state parameter
 */
function decodeOAuthData(encoded: string): {
  state: string
  codeVerifier: string
  redirectUrl?: string
} | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const jsonStr = atob(base64 + padding)
    const bytes = new Uint8Array(jsonStr.length)
    for (let i = 0; i < jsonStr.length; i++) {
      bytes[i] = jsonStr.charCodeAt(i)
    }
    const decoded = new TextDecoder().decode(bytes)
    return JSON.parse(decoded)
  } catch (error) {
    console.error('Failed to decode OAuth data:', error)
    return null
  }
}

/**
 * Store OAuth flow data in localStorage (fallback only)
 */
export function storeOAuthState(data: {
  state: string
  codeVerifier: string
  redirectUrl?: string
}) {
  localStorage.setItem(LOCAL_STORAGE_KEY.OAUTH_STATE, data.state)
  localStorage.setItem(LOCAL_STORAGE_KEY.OAUTH_CODE_VERIFIER, data.codeVerifier)
  if (data.redirectUrl) {
    localStorage.setItem(LOCAL_STORAGE_KEY.OAUTH_REDIRECT_URL, data.redirectUrl)
  }
}

/**
 * Retrieve and validate OAuth state from URL-encoded state or localStorage fallback
 */
export function retrieveOAuthState(state: string): {
  codeVerifier: string
  redirectUrl?: string
} | null {
  // First, try to decode from the state parameter itself
  const decoded = decodeOAuthData(state)
  if (decoded && decoded.state) {
    // Clean up localStorage if it exists
    localStorage.removeItem(LOCAL_STORAGE_KEY.OAUTH_STATE)
    localStorage.removeItem(LOCAL_STORAGE_KEY.OAUTH_CODE_VERIFIER)
    localStorage.removeItem(LOCAL_STORAGE_KEY.OAUTH_REDIRECT_URL)

    return {
      codeVerifier: decoded.codeVerifier,
      redirectUrl: decoded.redirectUrl,
    }
  }

  // Fallback to localStorage (for backward compatibility)
  const storedState = localStorage.getItem(LOCAL_STORAGE_KEY.OAUTH_STATE)
  const codeVerifier = localStorage.getItem(LOCAL_STORAGE_KEY.OAUTH_CODE_VERIFIER)

  if (!storedState || !codeVerifier || storedState !== state) {
    return null
  }

  const redirectUrl = localStorage.getItem(LOCAL_STORAGE_KEY.OAUTH_REDIRECT_URL) || undefined

  // Clean up
  localStorage.removeItem(LOCAL_STORAGE_KEY.OAUTH_STATE)
  localStorage.removeItem(LOCAL_STORAGE_KEY.OAUTH_CODE_VERIFIER)
  localStorage.removeItem(LOCAL_STORAGE_KEY.OAUTH_REDIRECT_URL)

  return { codeVerifier, redirectUrl }
}

/**
 * Build Keycloak authorization URL for Google login
 */
export async function buildGoogleAuthUrl(
  redirectUrl?: string
): Promise<string> {
  const { codeVerifier, codeChallenge } = await generatePKCE()
  const state = generateState()

  // Store in localStorage as fallback
  storeOAuthState({ state, codeVerifier, redirectUrl })

  // Encode the OAuth data into the state parameter for iOS Safari compatibility
  const encodedState = encodeOAuthData({ state, codeVerifier, redirectUrl })

  const authEndpoint = `${VITE_AUTH_URL}/realms/${VITE_AUTH_REALM}/protocol/openid-connect/auth`

  const params = new URLSearchParams({
    client_id: VITE_AUTH_CLIENT_ID,
    redirect_uri: VITE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state: encodedState, // Use encoded state instead of plain state
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    kc_idp_hint: 'google', // Direct to Google IdP in Keycloak
  })

  return `${authEndpoint}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<OAuthTokenResponse> {
  const tokenEndpoint = `${VITE_AUTH_URL}/realms/${VITE_AUTH_REALM}/protocol/openid-connect/token`

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: VITE_AUTH_CLIENT_ID,
    redirect_uri: VITE_OAUTH_REDIRECT_URI,
    code: code,
    code_verifier: codeVerifier,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token exchange failed: ${response.status} - ${error}`)
  }

  return response.json()
}

/**
 * Decode JWT token to extract user info (without verification)
 * Note: This is for reading claims only. Token validation happens server-side.
 */
export function decodeJWT(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format')
    }

    const payload = parts[1]
    // Decode base64url to binary string
    const binaryString = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    // Convert binary string to bytes
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    // Decode UTF-8 bytes to proper string
    const decoder = new TextDecoder('utf-8')
    const decoded = decoder.decode(bytes)
    return JSON.parse(decoded)
  } catch (error) {
    console.error('JWT decode error:', error)
    throw new Error('Failed to decode JWT token')
  }
}

/**
 * Extract user information from OAuth tokens
 */
export function extractUserFromTokens(
  tokens: OAuthTokenResponse
): User & { accessToken: string; refreshToken: string } {
  const claims = decodeJWT(tokens.access_token)

  return {
    id: (claims.sub as string) || '',
    name:
      (claims.name as string) || (claims.preferred_username as string) || '',
    email: (claims.email as string) || '',
    avatar: (claims.picture as string) || undefined,
    pro: false, // Will be determined by backend
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  }
}
