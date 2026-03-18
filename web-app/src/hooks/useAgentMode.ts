import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type AgentModeState = {
  /** Map of threadId → agent mode enabled */
  agentThreads: Record<string, boolean>

  isAgentMode: (threadId: string) => boolean
  toggleAgentMode: (threadId: string) => void
  setAgentMode: (threadId: string, enabled: boolean) => void
  removeThread: (threadId: string) => void
  /** Clear agent mode for all threads. */
  clearAll: () => void
}

export const useAgentMode = create<AgentModeState>()(
  persist(
    (set, get) => ({
      agentThreads: {},

      isAgentMode: (threadId) => {
        return get().agentThreads[threadId] === true
      },

      toggleAgentMode: (threadId) => {
        set((state) => ({
          agentThreads: {
            ...state.agentThreads,
            [threadId]: !state.agentThreads[threadId],
          },
        }))
      },

      setAgentMode: (threadId, enabled) => {
        set((state) => ({
          agentThreads: {
            ...state.agentThreads,
            [threadId]: enabled,
          },
        }))
      },

      removeThread: (threadId) => {
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [threadId]: _removed, ...rest } = state.agentThreads
          return { agentThreads: rest }
        })
      },

      clearAll: () => {
        set({ agentThreads: {} })
      },
    }),
    {
      name: localStorageKey.agentMode,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
