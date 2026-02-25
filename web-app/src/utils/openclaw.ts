import { invoke } from '@tauri-apps/api/core'

// Cache the OpenClaw running state to avoid repeated IPC calls
// This is updated when:
// 1. User enables/disables Remote Access in settings
// 2. On app startup if Remote Access was previously enabled
let openClawRunningCache: boolean | null = null
let lastCheckTime = 0
const CACHE_TTL_MS = 30000 // Re-check every 30 seconds at most

/**
 * Check if OpenClaw is running (with caching to avoid excessive IPC calls)
 *
 * This function is designed to be cheap to call frequently.
 * It caches the result and only makes an IPC call if:
 * - The cache is empty (first call)
 * - The cache is stale (older than 30 seconds)
 * - forceRefresh is true
 */
export async function isOpenClawRunning(forceRefresh = false): Promise<boolean> {
  const now = Date.now()

  // Return cached value if fresh
  if (!forceRefresh && openClawRunningCache !== null && (now - lastCheckTime) < CACHE_TTL_MS) {
    return openClawRunningCache
  }

  try {
    const status = await invoke<{ running: boolean }>('openclaw_status')
    openClawRunningCache = status.running
    lastCheckTime = now
    return status.running
  } catch {
    // If the invoke fails, OpenClaw is likely not installed
    openClawRunningCache = false
    lastCheckTime = now
    return false
  }
}

/**
 * Update the OpenClaw running cache directly
 * Called from the Remote Access settings page when user enables/disables OpenClaw
 */
export function setOpenClawRunningState(isRunning: boolean): void {
  openClawRunningCache = isRunning
  lastCheckTime = Date.now()
}

/**
 * Clear the OpenClaw cache (e.g., on app startup)
 */
export function clearOpenClawCache(): void {
  openClawRunningCache = null
  lastCheckTime = 0
}

/**
 * Get cached OpenClaw state without making an IPC call
 * Returns null if cache is empty/stale
 */
export function getOpenClawRunningCached(): boolean | null {
  const now = Date.now()
  if (openClawRunningCache !== null && (now - lastCheckTime) < CACHE_TTL_MS) {
    return openClawRunningCache
  }
  return null
}

/**
 * Sync the selected model from Jan to OpenClaw
 * This allows OpenClaw to use the same model that Jan is using
 *
 * This function is designed to have minimal impact on users who don't use OpenClaw:
 * - It first checks a cached state (no IPC call)
 * - Only makes IPC calls if OpenClaw is known to be running
 * - Fails silently if OpenClaw is not available
 *
 * @param modelId - The model ID (e.g., "minimax-m2.5")
 * @param provider - The provider name (e.g., "minimaxai", "openai", "llamacpp")
 * @param modelName - Optional display name for the model
 */
export async function syncModelToOpenClaw(
  modelId: string,
  provider?: string,
  modelName?: string
): Promise<void> {
  try {
    // Quick check: if we know OpenClaw is not running, skip entirely
    const cachedState = getOpenClawRunningCached()
    if (cachedState === false) {
      // We know OpenClaw is not running, skip without any IPC call
      return
    }

    // If cache is null/stale, do a fresh check
    const running = await isOpenClawRunning()
    if (!running) {
      console.debug('[OpenClaw] Not running, skipping model sync')
      return
    }

    await invoke('openclaw_sync_model', {
      modelId,
      provider: provider || null,
      modelName: modelName || null,
    })
    console.debug('[OpenClaw] Model synced:', modelId, provider)
  } catch (error) {
    // Don't throw - this is a background sync operation
    console.debug('[OpenClaw] Failed to sync model:', error)
  }
}

/**
 * Get the currently configured model in OpenClaw
 */
export async function getOpenClawModel(): Promise<string | null> {
  try {
    const model = await invoke<string>('openclaw_get_model')
    return model
  } catch {
    return null
  }
}
