import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type CapabilityToggles = {
  webSearch: boolean
  reasoning: boolean
  embeddings: boolean
}

export const DEFAULT_CAPABILITY_TOGGLES: CapabilityToggles = {
  webSearch: false,
  reasoning: false,
  embeddings: false,
}

type CapabilityTogglesState = {
  threads: Record<string, CapabilityToggles>
  getToggles: (threadId: string) => CapabilityToggles
  toggle: (threadId: string, capability: keyof CapabilityToggles) => void
  setToggle: (threadId: string, capability: keyof CapabilityToggles, value: boolean) => void
  removeThread: (threadId: string) => void
}

export const useCapabilityToggles = create<CapabilityTogglesState>()(
  persist(
    (set, get) => ({
      threads: {},

      getToggles: (threadId) => get().threads[threadId] ?? DEFAULT_CAPABILITY_TOGGLES,

      toggle: (threadId, capability) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [threadId]: {
              ...(state.threads[threadId] ?? DEFAULT_CAPABILITY_TOGGLES),
              [capability]: !(state.threads[threadId]?.[capability] ?? false),
            },
          },
        })),

      setToggle: (threadId, capability, value) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [threadId]: {
              ...(state.threads[threadId] ?? DEFAULT_CAPABILITY_TOGGLES),
              [capability]: value,
            },
          },
        })),

      removeThread: (threadId) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [threadId]: _removed, ...rest } = state.threads
          return { threads: rest }
        }),
    }),
    {
      name: localStorageKey.capabilityToggles,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
