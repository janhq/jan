import { invoke } from '@tauri-apps/api/core'

/**
 * Check if OpenClaw is running
 */
export async function isOpenClawRunning(): Promise<boolean> {
  try {
    const status = await invoke<{ running: boolean }>('openclaw_status')
    return status.running
  } catch {
    return false
  }
}

/**
 * Sync the selected model from Jan to OpenClaw
 * This allows OpenClaw to use the same model that Jan is using
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
    // Only sync if OpenClaw is running
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
