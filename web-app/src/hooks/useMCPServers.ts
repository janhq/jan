import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { updateMCPConfig } from '@/services/mcp'

// Define the structure of an MCP server configuration
export type MCPServerConfig = {
  command: string
  args: string[]
  env: Record<string, string>
  active?: boolean
}

// Define the structure of all MCP servers
export type MCPServers = {
  [key: string]: MCPServerConfig
}

type MCPServerStoreState = {
  open: boolean
  mcpServers: MCPServers
  loading: boolean
  deletedServerKeys: string[]
  setLeftPanel: (value: boolean) => void
  addServer: (key: string, config: MCPServerConfig) => void
  editServer: (key: string, config: MCPServerConfig) => void
  deleteServer: (key: string) => void
}

export const useMCPServers = create<MCPServerStoreState>()(
  persist(
    (set) => ({
      open: true,
      mcpServers: {}, // Start with empty object
      loading: false,
      deletedServerKeys: [],
      setLeftPanel: (value) => set({ open: value }),

      // Add a new MCP server or update if the key already exists
      addServer: (key, config) =>
        set((state) => {
          const mcpServers = { ...state.mcpServers, [key]: config }
          updateMCPConfig(JSON.stringify({ mcpServers }))
          return { mcpServers }
        }),

      // Edit an existing MCP server configuration
      editServer: (key, config) =>
        set((state) => {
          // Only proceed if the server exists
          if (!state.mcpServers[key]) return state

          const mcpServers = { ...state.mcpServers, [key]: config }
          updateMCPConfig(JSON.stringify({ mcpServers }))
          return { mcpServers }
        }),

      // Delete an MCP server by key
      deleteServer: (key) =>
        set((state) => {
          // Create a copy of the current state
          const updatedServers = { ...state.mcpServers }

          // Delete the server if it exists
          if (updatedServers[key]) {
            delete updatedServers[key]
          }
          updateMCPConfig(
            JSON.stringify({
              mcpServers: updatedServers,
            })
          )
          return {
            mcpServers: updatedServers,
            deletedServerKeys: [...state.deletedServerKeys, key],
          }
        }),
    }),
    {
      name: localStoregeKey.settingMCPSevers, // Using existing key for now
      storage: createJSONStorage(() => localStorage),
    }
  )
)
