/**
 * OAuth 2.0 PKCE (Proof Key for Code Exchange) utilities for Keycloak integration
 */

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
 * Store OAuth flow data in sessionStorage
 */
export function storeOAuthState(data: {
  state: string
  codeVerifier: string
  redirectUrl?: string
}) {
  sessionStorage.setItem('oauth_state', data.state)
  sessionStorage.setItem('oauth_code_verifier', data.codeVerifier)
  if (data.redirectUrl) {
    sessionStorage.setItem('oauth_redirect_url', data.redirectUrl)
  }
}

/**
 * Retrieve and validate OAuth state from sessionStorage
 */
export function retrieveOAuthState(state: string): {
  codeVerifier: string
  redirectUrl?: string
} | null {
  const storedState = sessionStorage.getItem('oauth_state')
  const codeVerifier = sessionStorage.getItem('oauth_code_verifier')

  if (!storedState || !codeVerifier || storedState !== state) {
    return null
  }

  const redirectUrl = sessionStorage.getItem('oauth_redirect_url') || undefined

  // Clean up
  sessionStorage.removeItem('oauth_state')
  sessionStorage.removeItem('oauth_code_verifier')
  sessionStorage.removeItem('oauth_redirect_url')

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

  // Store for later verification
  storeOAuthState({ state, codeVerifier, redirectUrl })

  const authEndpoint = `${VITE_AUTH_URL}/realms/${VITE_AUTH_REALM}/protocol/openid-connect/auth`

  const params = new URLSearchParams({
    client_id: VITE_AUTH_CLIENT_ID,
    redirect_uri: VITE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state: state,
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
