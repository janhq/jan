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
// Last value known to be on the backend, per key. Lets setItem skip the
// serialization + IPC round-trip when Zustand persist re-writes an unchanged
// blob (it fires setItem on every set(), without diffing). Only updated on a
// confirmed backend write/read so a failed invoke still retries next time.
const lastWritten = new Map<string, string>()

// Persist can issue another update before the previous IPC completes. Queue
// reads, writes and removals per key; deduplicate only when the operation runs
// so A -> B -> A cannot mistake the old on-disk A for the final desired state.
const pending = new Map<string, Promise<void>>()

function inOrder<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(name)
  const result = previous ? previous.then(operation) : operation()
  const settled = result.then(() => {}, () => {})
  pending.set(name, settled)
  void settled.then(() => {
    if (pending.get(name) === settled) pending.delete(name)
  })
  return result
}

export const backendStorage: StateStorage = {
  getItem: async (name) => {
    if (!isPlatformTauri()) return localStorage.getItem(name)
    return inOrder(name, async () => {
      try {
        const value = await getServiceHub().core().invoke<string | null>(
          'settings_get',
          { key: name }
        )
        if (value != null) lastWritten.set(name, value)
        else lastWritten.delete(name)
        return value ?? null
      } catch (error) {
        console.error(`settings_get failed for '${name}':`, error)
        return null
      }
    })
  },
  setItem: async (name, value) => {
    if (!isPlatformTauri()) {
      localStorage.setItem(name, value)
      return
    }
    return inOrder(name, async () => {
      if (lastWritten.get(name) === value) return
      try {
        await getServiceHub().core().invoke('settings_set', { key: name, value })
        lastWritten.set(name, value)
      } catch (error) {
        console.error(`settings_set failed for '${name}':`, error)
      }
    })
  },
  removeItem: async (name) => {
    if (!isPlatformTauri()) {
      localStorage.removeItem(name)
      return
    }
    return inOrder(name, async () => {
      try {
        await getServiceHub().core().invoke('settings_remove', { key: name })
        lastWritten.delete(name)
      } catch (error) {
        console.error(`settings_remove failed for '${name}':`, error)
      }
    })
  },
}
