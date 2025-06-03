import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { MCPTool } from '@/types/completion'

type ToolDisabledState = {
  // Track disabled tools per thread
  disabledTools: Record<string, string[]> // threadId -> toolNames[]
  // Global default disabled tools (for new threads/index page)
  defaultDisabledTools: string[]

  // Actions
  setToolDisabledForThread: (
    threadId: string,
    toolName: string,
    available: boolean
  ) => void
  isToolDisabled: (threadId: string, toolName: string) => boolean
  getDisabledToolsForThread: (threadId: string) => string[]
  setDefaultDisabledTools: (toolNames: string[]) => void
  getDefaultDisabledTools: () => string[]
  // Initialize thread tools from default or existing thread settings
  initializeThreadTools: (threadId: string, allTools: MCPTool[]) => void
}

export const useToolAvailable = create<ToolDisabledState>()(
  persist(
    (set, get) => ({
      disabledTools: {},
      defaultDisabledTools: [],

      setToolDisabledForThread: (
        threadId: string,
        toolName: string,
        available: boolean
      ) => {
        set((state) => {
          const currentTools = state.disabledTools[threadId] || []
          let updatedTools: string[]

          if (available) {
            // Remove disabled tool
            updatedTools = [...currentTools.filter((tool) => tool !== toolName)]
          } else {
            // Disable tool
            updatedTools = [...currentTools, toolName]
          }

          return {
            disabledTools: {
              ...state.disabledTools,
              [threadId]: updatedTools,
            },
          }
        })
      },

      isToolDisabled: (threadId: string, toolName: string) => {
        const state = get()
        // If no thread-specific settings, use default
        if (!state.disabledTools[threadId]) {
          return state.defaultDisabledTools.includes(toolName)
        }
        return state.disabledTools[threadId]?.includes(toolName) || false
      },

      getDisabledToolsForThread: (threadId: string) => {
        const state = get()
        // If no thread-specific settings, use default
        if (!state.disabledTools[threadId]) {
          return state.defaultDisabledTools
        }
        return state.disabledTools[threadId] || []
      },

      setDefaultDisabledTools: (toolNames: string[]) => {
        set({ defaultDisabledTools: toolNames })
      },

      getDefaultDisabledTools: () => {
        return get().defaultDisabledTools
      },

      initializeThreadTools: (threadId: string, allTools: MCPTool[]) => {
        const state = get()
        // If thread already has settings, don't override
        if (state.disabledTools[threadId]) {
          return
        }

        // Initialize with default tools only
        // Don't auto-enable all tools if defaults are explicitly empty
        const initialTools = state.defaultDisabledTools.filter((toolName) =>
          allTools.some((tool) => tool.name === toolName)
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
      }),
    }
  )
)
