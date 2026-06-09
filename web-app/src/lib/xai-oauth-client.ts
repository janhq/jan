import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { localStorageKey } from '@/constants/localStorage'

const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize'
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const DEVICE_AUTHORIZATION_URL = 'https://auth.x.ai/oauth2/device/code'
const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const SCOPE =
  'openid profile email offline_access grok-cli:access api:access'
const REDIRECT_URI = 'http://127.0.0.1:56121/callback'
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

const PENDING_LOGIN_KEY = 'xai-oauth-pending-login'

export type StoredXaiTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type XaiOAuthClientStatus = {
  connected: boolean
  expiresAt?: number
  loginInProgress: boolean
}

export type XaiOAuthDeviceLogin = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn?: number
  interval?: number
}

type PkceCodes = {
  verifier: string
  challenge: string
}

type PendingLogin = {
  pkce: PkceCodes
  state: string
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

type DeviceTokenErrorBody = {
  error?: string
  error_description?: string
}

function storageKey() {
  return `${localStorageKey.modelProvider}:xai-oauth-tokens`
}

function loadTokens(): StoredXaiTokens | null {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredXaiTokens
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return parsed
  } catch {
    return null
  }
}

function saveTokens(tokens: StoredXaiTokens) {
  localStorage.setItem(storageKey(), JSON.stringify(tokens))
}

function clearTokens() {
  localStorage.removeItem(storageKey())
  sessionStorage.removeItem(PENDING_LOGIN_KEY)
}

function loadPendingLogin(): PendingLogin | null {
  try {
    const raw = sessionStorage.getItem(PENDING_LOGIN_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PendingLogin
  } catch {
    return null
  }
}

function savePendingLogin(pending: PendingLogin) {
  sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify(pending))
}

function clearPendingLogin() {
  sessionStorage.removeItem(PENDING_LOGIN_KEY)
}

function generateRandomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function generatePkce(): Promise<PkceCodes> {
  const verifier = generateRandomString(64)
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  )
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'Jan/0.8',
  }
}

function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function accessTokenIsExpiring(
  token: string | undefined,
  skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length < 2) return false
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (payload.length % 4 !== 0) payload += '='
    const claims = JSON.parse(atob(payload)) as { exp?: number }
    if (typeof claims.exp !== 'number') return false
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs)
  } catch {
    return false
  }
}

function tokenNeedsRefresh(tokens: StoredXaiTokens): boolean {
  return (
    tokens.expiresAt <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS ||
    accessTokenIsExpiring(tokens.accessToken, ACCESS_TOKEN_REFRESH_SKEW_MS)
  )
}

async function postForm(
  url: string,
  body: URLSearchParams
): Promise<Response> {
  return tauriFetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: body.toString(),
  })
}

function tokenResponseToStored(
  body: TokenResponse,
  fallbackRefresh?: string
): StoredXaiTokens {
  const refreshToken = body.refresh_token ?? fallbackRefresh
  if (!refreshToken) {
    throw new Error('xAI token response is missing refresh_token')
  }
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
}

export function buildAuthorizeUrl(pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    nonce: generateState(),
    plan: 'generic',
    referrer: 'jan',
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

async function exchangeCodeForTokens(
  code: string,
  pkce: PkceCodes
): Promise<StoredXaiTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: pkce.verifier,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  })
  const response = await postForm(TOKEN_URL, body)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `xAI token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`
    )
  }
  const json = (await response.json()) as TokenResponse
  return tokenResponseToStored(json)
}

async function refreshAccessToken(
  refreshToken: string
): Promise<StoredXaiTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  })
  const response = await postForm(TOKEN_URL, body)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ''}`
    )
  }
  const json = (await response.json()) as TokenResponse
  return tokenResponseToStored(json, refreshToken)
}

let refreshPromise: Promise<StoredXaiTokens> | null = null

export async function resolveAccessToken(): Promise<string | null> {
  const stored = loadTokens()
  if (!stored) return null
  if (!tokenNeedsRefresh(stored)) return stored.accessToken

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(stored.refreshToken)
      .then((refreshed) => {
        saveTokens(refreshed)
        return refreshed
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  try {
    const refreshed = await refreshPromise
    return refreshed.accessToken
  } catch {
    clearTokens()
    return null
  }
}

export function getClientStatus(): XaiOAuthClientStatus {
  const stored = loadTokens()
  return {
    connected: Boolean(stored),
    expiresAt: stored?.expiresAt,
    loginInProgress: Boolean(loadPendingLogin()),
  }
}

export async function startBrowserLogin(): Promise<string> {
  const pkce = await generatePkce()
  const state = generateState()
  savePendingLogin({ pkce, state })
  return buildAuthorizeUrl(pkce, state)
}

export function cancelBrowserLogin() {
  clearPendingLogin()
}

export function parseOAuthCallbackInput(input: string): {
  code: string
  state: string | null
} {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Authorization code or callback URL is required')
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const parsed = new URL(trimmed)
    const error = parsed.searchParams.get('error')
    if (error) {
      throw new Error(parsed.searchParams.get('error_description') ?? error)
    }
    const code = parsed.searchParams.get('code')
    if (!code) {
      throw new Error('Callback URL is missing authorization code')
    }
    return {
      code,
      state: parsed.searchParams.get('state'),
    }
  }

  return { code: trimmed, state: null }
}

export async function completeBrowserCallback(
  callbackUrlOrCode: string
): Promise<StoredXaiTokens> {
  const { code, state } = parseOAuthCallbackInput(callbackUrlOrCode)

  const pending = loadPendingLogin()
  if (!pending) {
    throw new Error(
      'No OAuth login in progress. Click Sign in with SuperGrok again, then paste the code without refreshing this page.'
    )
  }
  if (state && pending.state !== state) {
    throw new Error('Invalid state - potential CSRF attack')
  }

  const tokens = await exchangeCodeForTokens(code, pending.pkce)
  saveTokens(tokens)
  clearPendingLogin()
  return tokens
}

export async function requestDeviceCode(): Promise<XaiOAuthDeviceLogin> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPE,
  })
  const response = await postForm(DEVICE_AUTHORIZATION_URL, body)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `xAI device code request failed (${response.status})${detail ? `: ${detail}` : ''}`
    )
  }
  const json = (await response.json()) as DeviceCodeResponse
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresIn: json.expires_in,
    interval: json.interval,
  }
}

export async function pollDeviceCodeToken(
  device: XaiOAuthDeviceLogin
): Promise<StoredXaiTokens> {
  const expiresInMs = positiveSecondsToMs(
    device.expiresIn,
    DEVICE_CODE_DEFAULT_EXPIRES_MS
  )
  const deadline = Date.now() + expiresInMs
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS
  )

  while (Date.now() < deadline) {
    const body = new URLSearchParams({
      grant_type: DEVICE_CODE_GRANT_TYPE,
      client_id: CLIENT_ID,
      device_code: device.deviceCode,
    })
    const response = await postForm(TOKEN_URL, body)
    if (response.ok) {
      const json = (await response.json()) as TokenResponse
      const tokens = tokenResponseToStored(json)
      saveTokens(tokens)
      return tokens
    }

    const errorBody = (await response.json().catch(() => ({}))) as DeviceTokenErrorBody
    const remaining = Math.max(0, deadline - Date.now())

    switch (errorBody.error) {
      case 'authorization_pending':
        await sleep(
          Math.max(
            1,
            Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining)
          )
        )
        continue
      case 'slow_down':
        intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
        await sleep(
          Math.max(
            1,
            Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining)
          )
        )
        continue
      case 'access_denied':
      case 'authorization_denied':
        throw new Error('xAI device authorization was denied')
      case 'expired_token':
        throw new Error('xAI device code expired - please re-run login')
      default: {
        const detail =
          errorBody.error_description ?? errorBody.error ?? 'unknown error'
        throw new Error(
          `xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`
        )
      }
    }
  }

  throw new Error('xAI device authorization timed out')
}

export function logoutClient() {
  clearTokens()
}