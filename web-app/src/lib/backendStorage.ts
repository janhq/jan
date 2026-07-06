import type { StateStorage } from 'zustand/middleware'
import { isPlatformTauri } from '@/lib/platform/utils'
import { getServiceHub } from '@/hooks/useServiceHub'

/**
 * Async Zustand `StateStorage` backed by the Rust settings store
 * (`settings_get`/`settings_set`/`settings_remove`), which persists to
 * `<jan_data>/settings.json`. This keeps user settings off webview
 * localStorage so out-of-process consumers (jan-cli) can read them.
 *
 * On web (`dev:web`, no Tauri shell) there is no backend, so it degrades to
 * localStorage. The async boundary is honest: stores using this must set
 * `skipHydration: true` and be rehydrated via `hydrateBackendStores()` only
 * after the ServiceHub is initialized (`getServiceHub()` throws before that).
 */
export const backendStorage: StateStorage = {
  getItem: async (name) => {
    if (!isPlatformTauri()) return localStorage.getItem(name)
    try {
      const value = await getServiceHub().core().invoke<string | null>(
        'settings_get',
        { key: name }
      )
      return value ?? null
    } catch (error) {
      console.error(`settings_get failed for '${name}':`, error)
      return null
    }
  },
  setItem: async (name, value) => {
    if (!isPlatformTauri()) {
      localStorage.setItem(name, value)
      return
    }
    try {
      await getServiceHub().core().invoke('settings_set', { key: name, value })
    } catch (error) {
      console.error(`settings_set failed for '${name}':`, error)
    }
  },
  removeItem: async (name) => {
    if (!isPlatformTauri()) {
      localStorage.removeItem(name)
      return
    }
    try {
      await getServiceHub().core().invoke('settings_remove', { key: name })
    } catch (error) {
      console.error(`settings_remove failed for '${name}':`, error)
    }
  },
}
