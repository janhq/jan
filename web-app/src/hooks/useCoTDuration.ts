import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { backendStorage } from '@/lib/backendStorage'
import { localStorageKey } from '@/constants/localStorage'

/**
 * Preserves the "thought/worked for Ns" duration of a folded chain-of-thought
 * across reloads. `ChainOfThought` measures the trace live in component state,
 * which a reload throws away; keyed by the (stable) message id, that measurement
 * is stored here and seeded back on restore. Shared by both chat surfaces since
 * message ids are stable in each.
 */
const MAX_ENTRIES = 500

type CoTDurationState = {
  /** Message id -> accumulated trace duration in ms. */
  durations: Record<string, number>
  record: (messageId: string, ms: number) => void
}

export const useCoTDuration = create<CoTDurationState>()(
  persist(
    (set) => ({
      durations: {},
      record: (messageId, ms) =>
        set((state) => {
          if (state.durations[messageId] === ms) return state
          const next = { ...state.durations, [messageId]: ms }
          const keys = Object.keys(next)
          // Bounded so an old session's ids cannot grow the blob without limit;
          // a dropped entry just falls back to the live/"a while" label.
          if (keys.length > MAX_ENTRIES) {
            for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
              delete next[key]
            }
          }
          return { durations: next }
        }),
    }),
    {
      name: localStorageKey.cotDuration,
      storage: createJSONStorage(() => backendStorage),
      // Async storage: rehydrated in hydrateBackendStores() once the ServiceHub
      // is ready, like the other backend-backed stores.
      skipHydration: true,
    }
  )
)
