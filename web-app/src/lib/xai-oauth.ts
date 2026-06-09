import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { localStorageKey } from '@/constants/localStorage'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  cancelBrowserLogin,
  completeBrowserCallback,
  getClientStatus,
  logoutClient,
  pollDeviceCodeToken,
  requestDeviceCode,
  resolveAccessToken,
  startBrowserLogin,
  type XaiOAuthDeviceLogin as ClientDeviceLogin,
} from '@/lib/xai-oauth-client'

const XAI_OAUTH_CONNECTED_CACHE_KEY = `${localStorageKey.modelProvider}:xai-oauth-connected`

export function isXaiOAuthConnectedSync(): boolean {
  if (getClientStatus().connected) return true
  try {
    return localStorage.getItem(XAI_OAUTH_CONNECTED_CACHE_KEY) === '1'
  } catch {
    return false
  }
}

export function setXaiOAuthConnectedCache(connected: boolean): void {
  try {
    if (connected) {
      localStorage.setItem(XAI_OAUTH_CONNECTED_CACHE_KEY, '1')
    } else {
      localStorage.removeItem(XAI_OAUTH_CONNECTED_CACHE_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

export type XaiOAuthStatus = {
  connected: boolean
  expiresAt?: number
  loginInProgress: boolean
}

export type XaiOAuthLoginResult = {
  success: boolean
  expiresAt?: number
  error?: string
}

export type XaiOAuthDeviceLogin = ClientDeviceLogin

let nativeCommandsAvailable: boolean | null = null

export function isXaiOAuthAvailable(): boolean {
  return isPlatformTauri()
}

function isCommandNotFoundError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return /command .+ not found/i.test(message)
}

async function canUseNativeCommands(): Promise<boolean> {
  if (!isXaiOAuthAvailable()) return false
  if (nativeCommandsAvailable != null) return nativeCommandsAvailable
  try {
    await invoke<XaiOAuthStatus>('xai_oauth_status')
    nativeCommandsAvailable = true
  } catch (error) {
    nativeCommandsAvailable = !isCommandNotFoundError(error)
    if (!nativeCommandsAvailable) return false
    throw error
  }
  return nativeCommandsAvailable
}

export async function getXaiOAuthStatus(): Promise<XaiOAuthStatus | null> {
  if (!isXaiOAuthAvailable()) return null
  const status = await (async () => {
    if (await canUseNativeCommands()) {
      return invoke<XaiOAuthStatus>('xai_oauth_status')
    }
    return getClientStatus()
  })()
  setXaiOAuthConnectedCache(status?.connected ?? false)
  return status
}

export async function startXaiOAuthLogin(): Promise<string> {
  if (await canUseNativeCommands()) {
    const response = await invoke<{ authorizeUrl: string }>('xai_oauth_start_login')
    return response.authorizeUrl
  }
  return startBrowserLogin()
}

export async function cancelXaiOAuthLogin(): Promise<void> {
  if (await canUseNativeCommands()) {
    await invoke('xai_oauth_cancel_login')
    return
  }
  cancelBrowserLogin()
}

export async function completeXaiOAuthCallback(
  callbackUrl: string
): Promise<XaiOAuthLoginResult> {
  if (await canUseNativeCommands()) {
    const result = await invoke<XaiOAuthLoginResult>('xai_oauth_complete_callback', {
      callbackUrl,
    })
    setXaiOAuthConnectedCache(result.success)
    return result
  }
  try {
    const tokens = await completeBrowserCallback(callbackUrl)
    setXaiOAuthConnectedCache(true)
    return {
      success: true,
      expiresAt: tokens.expiresAt,
    }
  } catch (error) {
    setXaiOAuthConnectedCache(false)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getXaiOAuthAccessToken(): Promise<string | null> {
  if (!isXaiOAuthAvailable()) return null
  if (await canUseNativeCommands()) {
    try {
      const response = await invoke<{ accessToken: string }>(
        'xai_oauth_get_access_token'
      )
      setXaiOAuthConnectedCache(true)
      return response.accessToken
    } catch {
      setXaiOAuthConnectedCache(false)
      return null
    }
  }
  const token = await resolveAccessToken()
  setXaiOAuthConnectedCache(Boolean(token))
  return token
}

export async function logoutXaiOAuth(): Promise<void> {
  setXaiOAuthConnectedCache(false)
  if (await canUseNativeCommands()) {
    await invoke('xai_oauth_logout')
    return
  }
  logoutClient()
}

export async function startXaiDeviceLogin(): Promise<XaiOAuthDeviceLogin> {
  if (await canUseNativeCommands()) {
    return invoke<XaiOAuthDeviceLogin>('xai_oauth_start_device_login')
  }
  return requestDeviceCode()
}

export async function pollXaiDeviceLogin(
  device: XaiOAuthDeviceLogin
): Promise<XaiOAuthLoginResult> {
  if (await canUseNativeCommands()) {
    const result = await invoke<XaiOAuthLoginResult>('xai_oauth_poll_device_login', {
      deviceCode: device.deviceCode,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      expiresIn: device.expiresIn,
      interval: device.interval,
    })
    setXaiOAuthConnectedCache(result.success)
    return result
  }
  try {
    const tokens = await pollDeviceCodeToken(device)
    setXaiOAuthConnectedCache(true)
    return {
      success: true,
      expiresAt: tokens.expiresAt,
    }
  } catch (error) {
    setXaiOAuthConnectedCache(false)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function onXaiOAuthLoginComplete(
  handler: (result: XaiOAuthLoginResult) => void
): Promise<UnlistenFn> {
  return listen<XaiOAuthLoginResult>('xai-oauth-login-complete', (event) => {
    setXaiOAuthConnectedCache(event.payload.success)
    handler(event.payload)
  })
}

export function formatXaiOAuthExpiry(expiresAt?: number): string | null {
  if (!expiresAt) return null
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export async function probeNativeXaiOAuthBackend(): Promise<boolean> {
  return canUseNativeCommands()
}

export function usesNativeXaiOAuthBackend(): boolean {
  return nativeCommandsAvailable === true
}