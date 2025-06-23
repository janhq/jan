import { create } from 'zustand'
import { restartMCPServers, updateMCPConfig } from '@/services/mcp'

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
  getServerConfig: (key: string) => MCPServerConfig | undefined
  setLeftPanel: (value: boolean) => void
  addServer: (key: string, config: MCPServerConfig) => void
  editServer: (key: string, config: MCPServerConfig) => void
  deleteServer: (key: string) => void
  setServers: (servers: MCPServers) => void
  deactivateServer: (serverName: string) => void
  syncServers: () => void
  syncServersAndRestart: () => void
}

export const useMCPServers = create<MCPServerStoreState>()((set, get) => ({
  open: true,
  mcpServers: {}, // Start with empty object
  loading: false,
  deletedServerKeys: [],
  setLeftPanel: (value) => set({ open: value }),
  getServerConfig: (key) => {
    const mcpServers = get().mcpServers
    // Return the server configuration if it exists, otherwise return undefined
    return mcpServers[key] ? mcpServers[key] : undefined
  },
  // Add a new MCP server or update if the key already exists
  addServer: (key, config) =>
    set((state) => {
      const mcpServers = { ...state.mcpServers, [key]: config }
      return { mcpServers }
    }),

  // Edit an existing MCP server configuration
  editServer: (key, config) =>
    set((state) => {
      // Only proceed if the server exists
      if (!state.mcpServers[key]) return state

      const mcpServers = { ...state.mcpServers, [key]: config }
      return { mcpServers }
    }),
  setServers: (servers) =>
    set((state) => {
      const mcpServers = { ...state.mcpServers, ...servers }
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
      return {
        mcpServers: updatedServers,
        deletedServerKeys: [...state.deletedServerKeys, key],
      }
    }),
  
  // Deactivate an MCP server (set active to false)
  deactivateServer: (serverName) =>
    set((state) => {
      // Only proceed if the server exists
      if (!state.mcpServers[serverName]) return state

      const mcpServers = {
        ...state.mcpServers,
        [serverName]: {
          ...state.mcpServers[serverName],
          active: false,
        },
      }
      return { mcpServers }
    }),
  syncServers: async () => {
    const mcpServers = get().mcpServers
    await updateMCPConfig(
      JSON.stringify({
        mcpServers,
      })
    )
  },
  syncServersAndRestart: async () => {
    const mcpServers = get().mcpServers
    await updateMCPConfig(
      JSON.stringify({
        mcpServers,
      })
    ).then(() => restartMCPServers())
  },
}))
