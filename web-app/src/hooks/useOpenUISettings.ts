import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type OpenUIComponentLibrary = 'chat' | 'standard'

interface OpenUISettingsState {
  enabledThreads: Record<string, boolean>
  componentLibrary: OpenUIComponentLibrary
  isEnabled: (threadId: string) => boolean
  setEnabled: (threadId: string, enabled: boolean) => void
  toggleEnabled: (threadId: string) => void
  transferThread: (sourceThreadId: string, targetThreadId: string) => void
  removeThread: (threadId: string) => void
  clearAllThreads: () => void
  setComponentLibrary: (componentLibrary: OpenUIComponentLibrary) => void
}

type OpenUISettingsPersistedSlice = Pick<
  OpenUISettingsState,
  'enabledThreads' | 'componentLibrary'
>

const defaultOpenUISettings: OpenUISettingsPersistedSlice = {
  enabledThreads: {},
  componentLibrary: 'chat',
}

const openUIStorage = createJSONStorage<OpenUISettingsPersistedSlice>(
  () => localStorage
)

export const useOpenUISettings = create<OpenUISettingsState>()(
  persist<
    OpenUISettingsState,
    [],
    [],
    OpenUISettingsPersistedSlice
  >(
    (set, get) => ({
      ...defaultOpenUISettings,
      isEnabled: (threadId) => get().enabledThreads[threadId] === true,
      setEnabled: (threadId, enabled) =>
        set((state) => ({
          enabledThreads: {
            ...state.enabledThreads,
            [threadId]: enabled,
          },
        })),
      toggleEnabled: (threadId) =>
        set((state) => ({
          enabledThreads: {
            ...state.enabledThreads,
            [threadId]: state.enabledThreads[threadId] !== true,
          },
        })),
      transferThread: (sourceThreadId, targetThreadId) =>
        set((state) => {
          if (sourceThreadId === targetThreadId) return state

          const { [sourceThreadId]: sourceEnabled, ...remainingThreads } =
            state.enabledThreads
          if (sourceEnabled === undefined) {
            return { enabledThreads: remainingThreads }
          }

          return {
            enabledThreads: {
              ...remainingThreads,
              [targetThreadId]: sourceEnabled,
            },
          }
        }),
      removeThread: (threadId) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [threadId]: _removed, ...enabledThreads } =
            state.enabledThreads
          return { enabledThreads }
        }),
      clearAllThreads: () => set({ enabledThreads: {} }),
      setComponentLibrary: (componentLibrary) => set({ componentLibrary }),
    }),
    {
      name: localStorageKey.openUI,
      storage: openUIStorage,
      version: 1,
      migrate: (persistedState) => {
        const previous = persistedState as
          | {
              componentLibrary?: OpenUIComponentLibrary
              enabledThreads?: Record<string, boolean>
            }
          | undefined

        return {
          enabledThreads: previous?.enabledThreads ?? {},
          componentLibrary: previous?.componentLibrary ?? 'chat',
        }
      },
      partialize: (state) => ({
        enabledThreads: state.enabledThreads,
        componentLibrary: state.componentLibrary,
      }),
    }
  )
)
