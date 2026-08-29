import type { StateStorage } from 'zustand/middleware'
import { isPlatformTauri } from '@/lib/platform/utils'
import { getServiceHub } from '@/hooks/useServiceHub'
import { localStorageKey } from '@/constants/localStorage'

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

// 进度类 key(下载中每秒都在变)的写盘合并:至多每 2s 落盘一次,避免
// settings.json 每秒全量重写。崩溃最多丢 2s 的 UI 进度显示;磁盘断点账本
// 由 Rust 实时写(.meta.json),断点续传不受影响。
const DEBOUNCED_KEYS = new Set<string>([localStorageKey.pausedDownloads])
const DEBOUNCE_MS = 2000
const pendingWrites = new Map<
  string,
  { value: string; timer: ReturnType<typeof setTimeout> }
>()

const writeThrough = async (name: string, value: string) => {
  try {
    await getServiceHub().core().invoke('settings_set', { key: name, value })
    lastWritten.set(name, value)
  } catch (error) {
    console.error(`settings_set failed for '${name}':`, error)
  }
}

export const backendStorage: StateStorage = {
  getItem: async (name) => {
    if (!isPlatformTauri()) return localStorage.getItem(name)
    try {
      const value = await getServiceHub()
        .core()
        .invoke<string | null>('settings_get', { key: name })
      if (value != null) lastWritten.set(name, value)
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
    if (lastWritten.get(name) === value) return
    if (DEBOUNCED_KEYS.has(name)) {
      // 合并高频写:始终只保留最新值,定时器到点落盘一次
      const existing = pendingWrites.get(name)
      if (existing) clearTimeout(existing.timer)
      const timer = setTimeout(() => {
        const pending = pendingWrites.get(name)
        pendingWrites.delete(name)
        if (pending && lastWritten.get(name) !== pending.value) {
          void writeThrough(name, pending.value)
        }
      }, DEBOUNCE_MS)
      pendingWrites.set(name, { value, timer })
      return
    }
    await writeThrough(name, value)
  },
  removeItem: async (name) => {
    if (!isPlatformTauri()) {
      localStorage.removeItem(name)
      return
    }
    // 有待写的合并值时直接丢弃(删除语义优先)
    const pending = pendingWrites.get(name)
    if (pending) {
      clearTimeout(pending.timer)
      pendingWrites.delete(name)
    }
    try {
      await getServiceHub().core().invoke('settings_remove', { key: name })
      lastWritten.delete(name)
    } catch (error) {
      console.error(`settings_remove failed for '${name}':`, error)
    }
  },
}
