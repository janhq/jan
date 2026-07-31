import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

type ToolApprovalState = {
  /** threadId -> tool names trusted for that conversation only. */
  approvedTools: Record<string, string[]>
  /** MCP servers trusted in every conversation, tools included. */
  approvedServers: string[]
  /** Tools trusted in every conversation, for tools with no server. */
  approvedToolsGlobal: string[]
  allowAllMCPPermissions: boolean

  approveToolForThread: (threadId: string, toolName: string) => void
  approveServer: (serverName: string) => void
  approveToolEverywhere: (toolName: string) => void
  isToolApproved: (
    threadId: string,
    toolName: string,
    serverName?: string
  ) => boolean
  setAllowAllMCPPermissions: (allow: boolean) => void
}

export const useToolApproval = create<ToolApprovalState>()(
  persist(
    (set, get) => ({
      approvedTools: {},
      approvedServers: [],
      approvedToolsGlobal: [],
      allowAllMCPPermissions: false,

      approveToolForThread: (threadId: string, toolName: string) => {
        set((state) => ({
          approvedTools: {
            ...state.approvedTools,
            [threadId]: [
              ...(state.approvedTools[threadId] || []),
              toolName,
            ].filter((tool, index, arr) => arr.indexOf(tool) === index), // Remove duplicates
          },
        }))
      },

      approveServer: (serverName: string) => {
        set((state) =>
          state.approvedServers.includes(serverName)
            ? state
            : { approvedServers: [...state.approvedServers, serverName] }
        )
      },

      approveToolEverywhere: (toolName: string) => {
        set((state) =>
          state.approvedToolsGlobal.includes(toolName)
            ? state
            : { approvedToolsGlobal: [...state.approvedToolsGlobal, toolName] }
        )
      },

      isToolApproved: (
        threadId: string,
        toolName: string,
        serverName?: string
      ) => {
        const state = get()
        if (state.approvedToolsGlobal.includes(toolName)) return true
        if (serverName && state.approvedServers.includes(serverName)) {
          return true
        }
        return state.approvedTools[threadId]?.includes(toolName) || false
      },

      setAllowAllMCPPermissions: (allow: boolean) => {
        set({ allowAllMCPPermissions: allow })
      },
    }),
    {
      name: localStorageKey.toolApproval,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      // Only persist approved tools and global permission setting, not modal state
      partialize: (state) => ({
        approvedTools: state.approvedTools,
        approvedServers: state.approvedServers,
        approvedToolsGlobal: state.approvedToolsGlobal,
        allowAllMCPPermissions: state.allowAllMCPPermissions,
      }),
    }
  )
)
