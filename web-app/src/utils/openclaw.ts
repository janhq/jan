import { invoke } from '@tauri-apps/api/core'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAppState } from '@/hooks/useAppState'
import type { JanGatewaySettings } from '@/types/openclaw'

/** Default local gateway URL. */
const LOCAL_GATEWAY_URL = 'http://127.0.0.1:18789/v1'

/** @deprecated Use getOpenClawGatewayUrl() for remote-mode support. */
export const OPENCLAW_GATEWAY_URL = LOCAL_GATEWAY_URL

let cachedGatewayUrl: string | null = null
let gatewayUrlFetchTime = 0
const GATEWAY_URL_CACHE_TTL = 30_000

/**
 * Resolve the OpenClaw gateway URL, respecting embedded vs remote mode.
 * Returns `{remote_url}/v1` in remote mode, local URL otherwise.
 */
export async function getOpenClawGatewayUrl(): Promise<string> {
  const now = Date.now()
  if (cachedGatewayUrl && (now - gatewayUrlFetchTime) < GATEWAY_URL_CACHE_TTL) {
    return cachedGatewayUrl
  }
  try {
    const settings = await invoke<JanGatewaySettings>('openclaw_get_gateway_settings')
    if (settings.mode === 'remote' && settings.remote_url) {
      const base = settings.remote_url.replace(/\/+$/, '')
      cachedGatewayUrl = `${base}/v1`
    } else {
      cachedGatewayUrl = LOCAL_GATEWAY_URL
    }
  } catch {
    cachedGatewayUrl = LOCAL_GATEWAY_URL
  }
  gatewayUrlFetchTime = now
  return cachedGatewayUrl
}

/** Get / set gateway settings via Tauri IPC. */
export async function getGatewaySettings(): Promise<JanGatewaySettings> {
  return invoke<JanGatewaySettings>('openclaw_get_gateway_settings')
}

export async function setGatewaySettings(settings: JanGatewaySettings): Promise<void> {
  await invoke('openclaw_set_gateway_settings', { settings })
  // Invalidate cached URL so the next call picks up the change
  cachedGatewayUrl = null
  gatewayUrlFetchTime = 0
  // Also invalidate running cache — mode changed
  clearOpenClawCache()
}

/** Check if we are currently in remote gateway mode. */
export async function isRemoteMode(): Promise<boolean> {
  try {
    const settings = await getGatewaySettings()
    return settings.mode === 'remote'
  } catch {
    return false
  }
}

let openClawRunningCache: boolean | null = null
let lastCheckTime = 0
const CACHE_TTL_MS = 30_000

/** Check if the openclaw feature was compiled into this binary. */
export async function isOpenClawFeatureAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>('openclaw_is_available')
  } catch {
    return false
  }
}

/** Check if OpenClaw is running, with a 30s cache to avoid excessive IPC calls. */
export async function isOpenClawRunning(forceRefresh = false): Promise<boolean> {
  const now = Date.now()
  if (!forceRefresh && openClawRunningCache !== null && (now - lastCheckTime) < CACHE_TTL_MS) {
    return openClawRunningCache
  }

  try {
    const status = await invoke<{ running: boolean }>('openclaw_status')
    openClawRunningCache = status.running
    lastCheckTime = now
    return status.running
  } catch {
    openClawRunningCache = false
    lastCheckTime = now
    return false
  }
}

/** Update the running cache directly (called when user enables/disables OpenClaw). */
export function setOpenClawRunningState(isRunning: boolean): void {
  openClawRunningCache = isRunning
  lastCheckTime = Date.now()

  useAppState.getState().setOpenClawRunning(isRunning)

  // When OpenClaw is stopped, clear agent mode for all threads so the UI reverts
  if (!isRunning) {
    useAgentMode.getState().clearAll()
  }
}

/** Clear the cache (e.g., on app startup). */
export function clearOpenClawCache(): void {
  openClawRunningCache = null
  lastCheckTime = 0
}

/** Get cached state without IPC. Returns null if stale. */
export function getOpenClawRunningCached(): boolean | null {
  const now = Date.now()
  if (openClawRunningCache !== null && (now - lastCheckTime) < CACHE_TTL_MS) {
    return openClawRunningCache
  }
  return null
}

/**
 * Sync the selected model to OpenClaw. Skips silently if OpenClaw is not running.
 * Designed to have minimal impact on users who don't use OpenClaw.
 */
export async function syncModelToOpenClaw(
  modelId: string,
  provider?: string,
  modelName?: string
): Promise<void> {
  try {
    const cachedState = getOpenClawRunningCached()
    if (cachedState === false) return

    const running = await isOpenClawRunning()
    if (!running) return

    await invoke('openclaw_sync_model', {
      modelId,
      provider: provider || null,
      modelName: modelName || null,
    })
  } catch {
    // Background sync — fail silently
  }
}

/**
 * Bulk sync all models from Jan's provider store to OpenClaw.
 * Called after Remote Access starts so OpenClaw knows the full catalog.
 */
export async function syncAllModelsToOpenClaw(
  providers: ModelProvider[],
  selectedModelId?: string
): Promise<number> {
  try {
    const models: Array<{ modelId: string; provider: string; displayName: string; contextWindow?: number }> = []

    for (const provider of providers) {
      if (!provider.active) continue
      if (!provider.models || provider.models.length === 0) continue
      for (const model of provider.models) {
        const modelId = model.id ?? model.model
        if (!modelId || typeof modelId !== 'string') continue
        if (model.embedding) continue

        // Extract context window from Jan's model settings (ctx_len)
        const ctxLenRaw = model.settings?.ctx_len?.controller_props?.value
        const contextWindow = typeof ctxLenRaw === 'number' && ctxLenRaw > 0
          ? ctxLenRaw
          : typeof ctxLenRaw === 'string' && parseInt(ctxLenRaw) > 0
            ? parseInt(ctxLenRaw)
            : undefined

        models.push({
          modelId,
          provider: provider.provider,
          displayName: model.displayName || model.name || modelId,
          contextWindow,
        })
      }
    }

    if (models.length === 0) return 0

    const result = await invoke<{ synced_count: number; default_model: string | null }>(
      'openclaw_sync_all_models',
      { models, defaultModelId: selectedModelId || null }
    )
    return result.synced_count
  } catch {
    return 0
  }
}

// --- Auth token ---

let authTokenCache: string | null = null
let authTokenFetchTime = 0
const AUTH_TOKEN_CACHE_TTL = 60_000
let httpApiEnsured = false

/**
 * Ensure the OpenClaw HTTP chat completions endpoint is enabled.
 * Called once before first agent mode request; no-op after that.
 * Skips entirely in remote mode — remote gateway manages its own config.
 * If the config was changed, restarts the gateway so it picks up the new setting.
 */
export async function ensureOpenClawHttpApi(): Promise<void> {
  if (httpApiEnsured) return
  // In remote mode the gateway is managed externally — skip local config
  if (await isRemoteMode()) {
    httpApiEnsured = true
    return
  }
  try {
    const changed = await invoke<boolean>('openclaw_ensure_http_api')
    if (changed) {
      await invoke('openclaw_restart')
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    httpApiEnsured = true
  } catch (error) {
    throw new Error(
      `Failed to initialize OpenClaw HTTP API: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** Get the OpenClaw gateway auth token, with a 60s cache. */
export async function getOpenClawAuthToken(forceRefresh = false): Promise<string | null> {
  const now = Date.now()
  if (!forceRefresh && authTokenCache && (now - authTokenFetchTime) < AUTH_TOKEN_CACHE_TTL) {
    return authTokenCache
  }
  try {
    const token = await invoke<string>('openclaw_get_auth_token')
    authTokenCache = token
    authTokenFetchTime = now
    return token
  } catch {
    authTokenCache = null
    return null
  }
}

/** TCP-level gateway reachability check via Tauri IPC. Works on all platforms. */
export async function checkOpenClawGateway(): Promise<boolean> {
  try {
    return await invoke<boolean>('openclaw_check_gateway')
  } catch {
    return false
  }
}

/** Get the currently configured model in OpenClaw. */
export async function getOpenClawModel(): Promise<string | null> {
  try {
    return await invoke<string>('openclaw_get_model')
  } catch {
    return null
  }
}

