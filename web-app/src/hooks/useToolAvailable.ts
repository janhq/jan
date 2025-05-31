import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { MCPTool } from '@/types/completion'

type ToolAvailableState = {
  // Track available tools per thread
  availableTools: Record<string, string[]> // threadId -> toolNames[]
  // Global default available tools (for new threads/index page)
  defaultAvailableTools: string[]

  // Actions
  setToolAvailableForThread: (
    threadId: string,
    toolName: string,
    available: boolean
  ) => void
  isToolAvailable: (threadId: string, toolName: string) => boolean
  getAvailableToolsForThread: (threadId: string) => string[]
  setDefaultAvailableTools: (toolNames: string[]) => void
  getDefaultAvailableTools: () => string[]
  // Initialize thread tools from default or existing thread settings
  initializeThreadTools: (threadId: string, allTools: MCPTool[]) => void
}

export const useToolAvailable = create<ToolAvailableState>()(
  persist(
    (set, get) => ({
      availableTools: {},
      defaultAvailableTools: [],

      setToolAvailableForThread: (
        threadId: string,
        toolName: string,
        available: boolean
      ) => {
        set((state) => {
          const currentTools = state.availableTools[threadId] || []
          let updatedTools: string[]

          if (available) {
            // Add tool if not already present
            updatedTools = currentTools.includes(toolName)
              ? currentTools
              : [...currentTools, toolName]
          } else {
            // Remove tool
            updatedTools = currentTools.filter((tool) => tool !== toolName)
          }

          return {
            availableTools: {
              ...state.availableTools,
              [threadId]: updatedTools,
            },
          }
        })
      },

      isToolAvailable: (threadId: string, toolName: string) => {
        const state = get()
        // If no thread-specific settings, use default
        if (!state.availableTools[threadId]) {
          return state.defaultAvailableTools.includes(toolName)
        }
        return state.availableTools[threadId]?.includes(toolName) || false
      },

      getAvailableToolsForThread: (threadId: string) => {
        const state = get()
        // If no thread-specific settings, use default
        if (!state.availableTools[threadId]) {
          return state.defaultAvailableTools
        }
        return state.availableTools[threadId] || []
      },

      setDefaultAvailableTools: (toolNames: string[]) => {
        set({ defaultAvailableTools: toolNames })
      },

      getDefaultAvailableTools: () => {
        return get().defaultAvailableTools
      },

      initializeThreadTools: (threadId: string, allTools: MCPTool[]) => {
        const state = get()
        // If thread already has settings, don't override
        if (state.availableTools[threadId]) {
          return
        }

        // Initialize with default tools only
        // Don't auto-enable all tools if defaults are explicitly empty
        const initialTools = state.defaultAvailableTools.filter((toolName) =>
          allTools.some((tool) => tool.name === toolName)
        )

        set((currentState) => ({
          availableTools: {
            ...currentState.availableTools,
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
        availableTools: state.availableTools,
        defaultAvailableTools: state.defaultAvailableTools,
      }),
    }
  )
)
