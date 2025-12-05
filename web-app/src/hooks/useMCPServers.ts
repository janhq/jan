import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'

// Define the structure of an MCP server configuration
export type MCPServerConfig = {
  command: string
  args: string[]
  env: Record<string, string>
  active?: boolean
  type?: 'stdio' | 'http' | 'sse'
  url?: string
  headers?: Record<string, string>
  timeout?: number
  official?: boolean
}

// Define the structure of all MCP servers
export type MCPServers = {
  [key: string]: MCPServerConfig
}

export type MCPSettings = {
  toolCallTimeoutSeconds: number
  baseRestartDelayMs: number
  maxRestartDelayMs: number
  backoffMultiplier: number
  proactiveMode: boolean
}

export const DEFAULT_MCP_SETTINGS: MCPSettings = {
  toolCallTimeoutSeconds: 30,
  baseRestartDelayMs: 1000,
  maxRestartDelayMs: 30000,
  backoffMultiplier: 2,
  proactiveMode: false,
}

type MCPServerStoreState = {
  open: boolean
  mcpServers: MCPServers
  settings: MCPSettings
  loading: boolean
  deletedServerKeys: string[]
  getServerConfig: (key: string) => MCPServerConfig | undefined
  setLeftPanel: (value: boolean) => void
  addServer: (key: string, config: MCPServerConfig) => void
  editServer: (key: string, config: MCPServerConfig) => void
  renameServer: (
    oldKey: string,
    newKey: string,
    config: MCPServerConfig
  ) => void
  deleteServer: (key: string) => void
  setServers: (servers: MCPServers) => void
  setSettings: (settings: MCPSettings) => void
  updateSettings: (partial: Partial<MCPSettings>) => void
  syncServers: () => Promise<void>
  syncServersAndRestart: () => Promise<void>
}

export const useMCPServers = create<MCPServerStoreState>()((set, get) => ({
  open: true,
  mcpServers: {}, // Start with empty object
  settings: { ...DEFAULT_MCP_SETTINGS },
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
      // Remove the key first if it exists to maintain insertion order
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _, ...restServers } = state.mcpServers
      const mcpServers = { [key]: config, ...restServers }
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

  // Rename a server while preserving its position
  renameServer: (oldKey, newKey, config) =>
    set((state) => {
      // Only proceed if the server exists
      if (!state.mcpServers[oldKey]) return state

      const entries = Object.entries(state.mcpServers)
      const mcpServers: MCPServers = {}

      // Rebuild the object with the same order, replacing the old key with the new key
      entries.forEach(([key, serverConfig]) => {
        if (key === oldKey) {
          mcpServers[newKey] = config
        } else {
          mcpServers[key] = serverConfig
        }
      })

      return { mcpServers }
    }),
  setServers: (servers) =>
    set((state) => {
      const mcpServers = { ...state.mcpServers, ...servers }
      return { mcpServers }
    }),
  setSettings: (settings) =>
    set(() => ({
      settings: {
        ...DEFAULT_MCP_SETTINGS,
        ...settings,
      },
    })),
  updateSettings: (partial) =>
    set((state) => ({
      settings: {
        ...state.settings,
        ...partial,
      },
    })),
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
  syncServers: async () => {
    const { mcpServers, settings } = get()
    await getServiceHub().mcp().updateMCPConfig(
      JSON.stringify({
        mcpServers,
        mcpSettings: settings,
      })
    )
  },
  syncServersAndRestart: async () => {
    const { mcpServers, settings } = get()
    await getServiceHub().mcp().updateMCPConfig(
      JSON.stringify({
        mcpServers,
        mcpSettings: settings,
      })
    ).then(() => getServiceHub().mcp().restartMCPServers())
  },
}))
