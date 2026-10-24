import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

// Composite key identifying a tool across servers.
export const createToolKey = (serverName: string, toolName: string) =>
  `${serverName}::${toolName}`

const isOldFormatKey = (key: string): boolean => !key.includes('::')

type ToolDisabledState = {
  // Global set of disabled tools (server::tool keys), shared across every chat.
  // A tool absent from this list is enabled.
  disabledTools: string[]

  setToolDisabled: (
    serverName: string,
    toolName: string,
    enabled: boolean
  ) => void
  isToolDisabled: (serverName: string, toolName: string) => boolean
  getDisabledTools: () => string[]
}

export const useToolAvailable = create<ToolDisabledState>()(
  persist(
    (set, get) => ({
      disabledTools: [],

      setToolDisabled: (serverName, toolName, enabled) => {
        const toolKey = createToolKey(serverName, toolName)
        set((state) => {
          if (enabled) {
            return {
              disabledTools: state.disabledTools.filter((k) => k !== toolKey),
            }
          }
          if (state.disabledTools.includes(toolKey)) return state
          return { disabledTools: [...state.disabledTools, toolKey] }
        })
      },

      isToolDisabled: (serverName, toolName) =>
        get().disabledTools.includes(createToolKey(serverName, toolName)),

      getDisabledTools: () => get().disabledTools,
    }),
    {
      name: localStorageKey.toolAvailability,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      partialize: (state) => ({ disabledTools: state.disabledTools }),
      // v2: tool availability is global, not per-thread. Collapse the old
      // { disabledTools: threadId->keys, defaultDisabledTools } shape onto the
      // previous global default; per-thread overrides and old pre-`::` keys
      // are dropped.
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 2) {
          const prevDefault = Array.isArray(state.defaultDisabledTools)
            ? (state.defaultDisabledTools as string[])
            : []
          return {
            disabledTools: prevDefault.filter((k) => !isOldFormatKey(k)),
          }
        }
        return state
      },
      version: 2,
    }
  )
)
