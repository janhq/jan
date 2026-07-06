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
  // Whether the one-time seed from the MCP extension's defaults has run.
  defaultsInitialized: boolean

  setToolDisabled: (
    serverName: string,
    toolName: string,
    enabled: boolean
  ) => void
  isToolDisabled: (serverName: string, toolName: string) => boolean
  getDisabledTools: () => string[]
  setDisabledTools: (toolKeys: string[]) => void
  isDefaultsInitialized: () => boolean
  markDefaultsAsInitialized: () => void
}

export const useToolAvailable = create<ToolDisabledState>()(
  persist(
    (set, get) => ({
      disabledTools: [],
      defaultsInitialized: false,

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

      setDisabledTools: (toolKeys) => set({ disabledTools: toolKeys }),

      isDefaultsInitialized: () => get().defaultsInitialized,
      markDefaultsAsInitialized: () => set({ defaultsInitialized: true }),
    }),
    {
      name: localStorageKey.toolAvailability,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      partialize: (state) => ({
        disabledTools: state.disabledTools,
        defaultsInitialized: state.defaultsInitialized,
      }),
      // v2: tool availability is global, not per-thread. Collapse the old
      // { disabledTools: threadId->keys, defaultDisabledTools } shape onto the
      // previous global default; per-thread overrides are dropped. Any old
      // pre-`::` keys force a re-seed from the extension on next boot.
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 2) {
          const prevDefault = Array.isArray(state.defaultDisabledTools)
            ? (state.defaultDisabledTools as string[])
            : []
          const clean = prevDefault.filter((k) => !isOldFormatKey(k))
          return {
            disabledTools: clean,
            defaultsInitialized:
              clean.length === prevDefault.length
                ? Boolean(state.defaultsInitialized)
                : false,
          }
        }
        return state
      },
      version: 2,
    }
  )
)
