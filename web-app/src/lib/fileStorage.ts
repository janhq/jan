/**
 * File-based storage adapter for zustand persist middleware.
 *
 * Desktop (Tauri): persists settings to a local JSON file via @tauri-apps/plugin-store.
 * Browser (dev/web): falls back to localStorage for compatibility.
 *
 * On first access of each key, existing localStorage data is automatically migrated
 * to the file store. localStorage is only cleared after a confirmed write to disk.
 */
import type { StateStorage } from 'zustand/middleware'

const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const STORE_FILENAME = 'settings.json'

// Minimal interface matching the subset of @tauri-apps/plugin-store we use.
// Keeps this module decoupled from Tauri types for testability.
interface TauriStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<boolean>
  save: () => Promise<void>
}

let store: TauriStore | null = null
let initPromise: Promise<void> | null = null

// Track per-key migration promises so concurrent getItem calls for the
// same key correctly wait for a single migration to finish.
const migrationPromises = new Map<string, Promise<void>>()

async function ensureStore(): Promise<void> {
  if (store) return
  if (initPromise) {
    await initPromise
    return
  }
  initPromise = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const dataFolder = await invoke<string>('get_jan_data_folder_path')
      const { load } = await import('@tauri-apps/plugin-store')
      const storePath = `${dataFolder}/${STORE_FILENAME}`
      store = await load(storePath, { autoSave: false, defaults: {} })
    } catch (e) {
      console.warn(
        'File storage unavailable, falling back to localStorage:',
        e
      )
    }
  })()
  await initPromise
}

/**
 * Persist in-memory state to disk. Called after every write so behaviour
 * matches localStorage (which persists synchronously). The save itself
 * is fire-and-forget — the in-memory state is already up-to-date, and
 * a failed flush will be overwritten by the next successful one.
 */
function persistToDisk(): void {
  store?.save().catch((e) => {
    console.warn('Failed to persist settings to disk:', e)
  })
}

/**
 * Migrate a single key from localStorage to the file store.
 * Runs once per key per session. Concurrent calls for the same key share
 * one promise so the migration isn't duplicated or raced against.
 * Data is only removed from localStorage after a confirmed disk write.
 */
function migrateFromLocalStorage(name: string): Promise<void> {
  const pending = migrationPromises.get(name)
  if (pending) return pending

  const promise = doMigrate(name)
  migrationPromises.set(name, promise)
  return promise
}

async function doMigrate(name: string): Promise<void> {
  try {
    const localValue = localStorage.getItem(name)
    if (localValue === null) return

    // Already in the file store — just clean up localStorage
    const existing = await store!.get(name)
    if (existing !== undefined && existing !== null) {
      localStorage.removeItem(name)
      return
    }

    // Copy to file store with an immediate flush for data safety
    await store!.set(name, localValue)
    await store!.save()
    localStorage.removeItem(name)
  } catch (e) {
    // Keep localStorage intact so we can retry next session
    migrationPromises.delete(name)
    console.warn(
      `Migration of "${name}" from localStorage to file storage failed:`,
      e
    )
  }
}

/**
 * Proactively migrate ALL localStorage keys to the file store.
 *
 * Should be called once at app startup so that users who update
 * the app will not lose any data — including keys that are read
 * directly via localStorage rather than through zustand stores.
 *
 * Safe to call multiple times; each key is migrated at most once
 * per session via the shared `migrationPromises` map.
 */
export async function migrateAllLocalStorageKeys(): Promise<void> {
  if (!IS_TAURI) return

  try {
    await ensureStore()
    if (!store) return

    // Snapshot all current localStorage keys
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) keys.push(key)
    }

    if (keys.length === 0) return

    // Copy each key into the file store (in-memory only, no disk I/O yet)
    const migratedKeys: string[] = []
    for (const key of keys) {
      // Skip keys already being migrated by a concurrent getItem call
      if (migrationPromises.has(key)) continue

      const localValue = localStorage.getItem(key)
      if (localValue === null) continue

      const existing = await store.get(key)
      if (existing !== undefined && existing !== null) {
        // Already in file store — just clean up localStorage
        localStorage.removeItem(key)
        continue
      }

      await store.set(key, localValue)
      migratedKeys.push(key)
    }

    if (migratedKeys.length === 0) return

    // Single flush to disk for all keys at once
    await store.save()

    // Only clean up localStorage after confirmed disk write
    for (const key of migratedKeys) {
      localStorage.removeItem(key)
      // Mark as migrated so lazy per-key migration skips these
      migrationPromises.set(key, Promise.resolve())
    }
  } catch (e) {
    // Keep localStorage intact so we can retry next session
    console.warn('Bulk migration from localStorage failed:', e)
  }
}

/**
 * Storage adapter compatible with zustand's createJSONStorage().
 *
 * Usage:
 *   import { fileStorage } from '@/lib/fileStorage'
 *   storage: createJSONStorage(() => fileStorage)
 */
export const fileStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!IS_TAURI) return localStorage.getItem(name)

    await ensureStore()
    if (!store) return localStorage.getItem(name)

    await migrateFromLocalStorage(name)
    const value = await store.get<string>(name)
    return value ?? null
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (!IS_TAURI) {
      localStorage.setItem(name, value)
      return
    }

    await ensureStore()
    if (!store) {
      localStorage.setItem(name, value)
      return
    }

    await store.set(name, value)
    persistToDisk()
  },

  removeItem: async (name: string): Promise<void> => {
    if (!IS_TAURI) {
      localStorage.removeItem(name)
      return
    }

    await ensureStore()
    if (!store) {
      localStorage.removeItem(name)
      return
    }

    await store.delete(name)
    persistToDisk()
  },
}
