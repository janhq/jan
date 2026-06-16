/**
 * Persisted per-integration manual binary-path overrides for the Launch page.
 *
 * Detection (`detect_agent_installed`) is a PATH lookup (`which`/`where`, plus
 * a WSL fallback on Windows). Agents installed in a non-standard location — or
 * only reachable in a way the probe can't see — show as "Not installed" with no
 * way to correct it. This store lets a user pin an explicit path per agent id;
 * when set, detection reports the agent installed iff that file exists.
 *
 * Unlike `launch-store` (transient, intentionally not persisted), these
 * overrides survive app reloads so the user sets them once.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { localStorageKey } from '@/constants/localStorage'

interface LaunchSettingsState {
  customPaths: Record<string, string>
  setCustomPath: (agentId: string, path: string) => void
}

export const useLaunchSettings = create<LaunchSettingsState>()(
  persist(
    (set) => ({
      customPaths: {},
      setCustomPath: (agentId, path) =>
        set((state) => {
          const next = { ...state.customPaths }
          const trimmed = path.trim()
          if (trimmed) {
            next[agentId] = trimmed
          } else {
            delete next[agentId]
          }
          return { customPaths: next }
        }),
    }),
    {
      name: localStorageKey.launchCustomPaths,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ customPaths: state.customPaths }),
    }
  )
)
