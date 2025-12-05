import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { MCPTool } from '@/types/completion'

// Helper function to create composite key for server+tool
const createToolKey = (serverName: string, toolName: string) => {
  return `${serverName}::${toolName}`
}

const isOldFormatKey = (key: string): boolean => {
  return !key.includes('::')
}

const migrateOldFormatIfNeeded = (
  disabledTools: Record<string, string[]>,
  defaultDisabledTools: string[]
): { disabledTools: Record<string, string[]>; defaultDisabledTools: string[] } => {
  const needsMigration =
    Object.values(disabledTools).some(tools => tools.some(isOldFormatKey)) ||
    defaultDisabledTools.some(isOldFormatKey)

  if (!needsMigration) {
    return { disabledTools, defaultDisabledTools }
  }

  console.log('[useToolAvailable] Migrating tool availability settings to new format (server::tool)')

  return {
    disabledTools: {},
    defaultDisabledTools: [],
  }
}

type ToolDisabledState = {
  // Track disabled tools per thread using server::tool composite keys
  disabledTools: Record<string, string[]> // threadId -> toolKeys[] (server::tool format)
  // Global default disabled tools (for new threads/index page) using composite keys
  defaultDisabledTools: string[]
  // Flag to track if defaults have been initialized from extension
  defaultsInitialized: boolean

  // Actions - now require both server and tool name
  setToolDisabledForThread: (
    threadId: string,
    serverName: string,
    toolName: string,
    available: boolean
  ) => void
  isToolDisabled: (threadId: string, serverName: string, toolName: string) => boolean
  getDisabledToolsForThread: (threadId: string) => string[]
  setDefaultDisabledTools: (toolKeys: string[]) => void
  getDefaultDisabledTools: () => string[]
  isDefaultsInitialized: () => boolean
  markDefaultsAsInitialized: () => void
  // Initialize thread tools from default or existing thread settings
  initializeThreadTools: (threadId: string, allTools: MCPTool[]) => void
}

export const useToolAvailable = create<ToolDisabledState>()(
  persist(
    (set, get) => ({
      disabledTools: {},
      defaultDisabledTools: [],
      defaultsInitialized: false,

      setToolDisabledForThread: (
        threadId: string,
        serverName: string,
        toolName: string,
        available: boolean
      ) => {
        set((state) => {
          const currentTools = state.disabledTools[threadId] || []
          const toolKey = createToolKey(serverName, toolName)
          let updatedTools: string[]

          if (available) {
            // Remove disabled tool
            updatedTools = [...currentTools.filter((key) => key !== toolKey)]
          } else {
            // Disable tool
            updatedTools = [...currentTools, toolKey]
          }

          return {
            disabledTools: {
              ...state.disabledTools,
              [threadId]: updatedTools,
            },
          }
        })
      },

      isToolDisabled: (threadId: string, serverName: string, toolName: string) => {
        const state = get()
        const toolKey = createToolKey(serverName, toolName)
        // If no thread-specific settings, use default
        if (!state.disabledTools[threadId]) {
          return state.defaultDisabledTools.includes(toolKey)
        }
        return state.disabledTools[threadId]?.includes(toolKey) || false
      },

      getDisabledToolsForThread: (threadId: string) => {
        const state = get()
        // If no thread-specific settings, use default
        if (!state.disabledTools[threadId]) {
          return state.defaultDisabledTools
        }
        return state.disabledTools[threadId] || []
      },

      setDefaultDisabledTools: (toolKeys: string[]) => {
        set({ defaultDisabledTools: toolKeys })
      },

      getDefaultDisabledTools: () => {
        return get().defaultDisabledTools
      },

      isDefaultsInitialized: () => {
        return get().defaultsInitialized
      },

      markDefaultsAsInitialized: () => {
        set({ defaultsInitialized: true })
      },

      initializeThreadTools: (threadId: string, allTools: MCPTool[]) => {
        const state = get()
        // If thread already has settings, don't override
        if (state.disabledTools[threadId]) {
          return
        }

        // Initialize with default tools only
        // Don't auto-enable all tools if defaults are explicitly empty
        const initialTools = state.defaultDisabledTools.filter((toolKey) =>
          allTools.some((tool) => createToolKey(tool.server, tool.name) === toolKey)
        )

        set((currentState) => ({
          disabledTools: {
            ...currentState.disabledTools,
            [threadId]: initialTools,
          },
        }))
      },
    }),
    {
      name: localStorageKey.toolAvailability,
      storage: createJSONStorage(() => localStorage),
      // Persist all state
      partialize: (state) => ({
        disabledTools: state.disabledTools,
        defaultDisabledTools: state.defaultDisabledTools,
        defaultsInitialized: state.defaultsInitialized,
      }),
      // Migration function to handle old format data
      migrate: (persistedState: unknown) => {
        if (persistedState && typeof persistedState === 'object') {
          const state = persistedState as Record<string, unknown>
          const migrated = migrateOldFormatIfNeeded(
            (state.disabledTools as Record<string, string[]>) || {},
            (state.defaultDisabledTools as string[]) || []
          )

          return {
            ...state,
            disabledTools: migrated.disabledTools,
            defaultDisabledTools: migrated.defaultDisabledTools,
            defaultsInitialized: migrated.disabledTools === state.disabledTools ?
              state.defaultsInitialized : false,
          }
        }
        return persistedState
      },
      version: 1, // Increment version to trigger migration
    }
  )
)
