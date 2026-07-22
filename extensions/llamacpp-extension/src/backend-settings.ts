import { invoke } from '@tauri-apps/api/core'
import { logger } from '@janhq/core'

/**
 * Read/write persisted settings through the Rust settings store
 * (`settings_get`/`settings_set`/`settings_remove` -> `settings.json`), the
 * same backend the web-app's Zustand stores use (see
 * web-app/src/lib/backendStorage.ts). This is the ONLY sanctioned way for the
 * extension to persist state; raw `localStorage` is reserved for one-time
 * migration reads of pre-backend data.
 */
export async function getBackendSetting(key: string): Promise<string | null> {
  try {
    return (await invoke<string | null>('settings_get', { key })) ?? null
  } catch (error) {
    logger.warn(`settings_get failed for '${key}':`, error)
    return null
  }
}

export async function setBackendSetting(
  key: string,
  value: string
): Promise<void> {
  try {
    await invoke('settings_set', { key, value })
  } catch (error) {
    logger.warn(`settings_set failed for '${key}':`, error)
  }
}

export async function removeBackendSetting(key: string): Promise<void> {
  try {
    await invoke('settings_remove', { key })
  } catch (error) {
    logger.warn(`settings_remove failed for '${key}':`, error)
  }
}
