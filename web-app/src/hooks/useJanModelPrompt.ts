import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { backendStorage } from '@/lib/backendStorage'

export type JanModelPromptDismissedState = {
  dismissedModelName: string | null
  setDismissedModelName: (modelName: string) => void
}

export const useJanModelPromptDismissed =
  create<JanModelPromptDismissedState>()(
    persist(
      (set) => ({
        dismissedModelName: null,
        setDismissedModelName: (modelName: string) =>
          set({ dismissedModelName: modelName }),
      }),
      {
        name: localStorageKey.janModelPromptDismissed,
        storage: createJSONStorage(() => backendStorage),
        skipHydration: true,
        version: 1,
        migrate: (persistedState: unknown) => {
          const state = persistedState as Record<string, unknown>
          if ('dismissed' in state && !('dismissedModelName' in state)) {
            return { dismissedModelName: null }
          }
          return state as JanModelPromptDismissedState
        },
      }
    )
  )
