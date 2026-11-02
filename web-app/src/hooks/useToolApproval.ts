import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

type ToolApprovalState = {
  /** Legacy/no-server thread grants; never authorize server-qualified tools. */
  approvedTools: Record<string, string[]>
  /** Exact identities, stored separately so legacy names cannot widen trust. */
  approvedMCPTools: {
    threadId: string
    serverName: string
    toolName: string
  }[]
  /** MCP servers trusted in every conversation, tools included. */
  approvedServers: string[]
  /** Tools trusted in every conversation, for tools with no server. */
  approvedToolsGlobal: string[]
  allowAllMCPPermissions: boolean

  approveToolForThread: (
    threadId: string,
    toolName: string,
    serverName?: string
  ) => void
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
      approvedMCPTools: [],
      approvedServers: [],
      approvedToolsGlobal: [],
      allowAllMCPPermissions: false,

      approveToolForThread: (threadId, toolName, serverName) => {
        if (serverName) {
          set((state) =>
            state.approvedMCPTools.some(
              (grant) =>
                grant.threadId === threadId &&
                grant.serverName === serverName &&
                grant.toolName === toolName
            )
              ? state
              : {
                  approvedMCPTools: [
                    ...state.approvedMCPTools,
                    { threadId, serverName, toolName },
                  ],
                }
          )
          return
        }
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
        if (serverName) {
          return (
            state.approvedServers.includes(serverName) ||
            state.approvedMCPTools.some(
              (grant) =>
                grant.threadId === threadId &&
                grant.serverName === serverName &&
                grant.toolName === toolName
            )
          )
        }
        if (state.approvedToolsGlobal.includes(toolName)) return true
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
      // Only persist grants and global permission setting, not modal state
      partialize: (state) => ({
        approvedTools: state.approvedTools,
        approvedMCPTools: state.approvedMCPTools,
        approvedServers: state.approvedServers,
        approvedToolsGlobal: state.approvedToolsGlobal,
        allowAllMCPPermissions: state.allowAllMCPPermissions,
      }),
    }
  )
)
