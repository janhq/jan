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
  fetchMCPServers: () => Promise<void>
}

// Mock data for MCP servers
export const mockMCPServers: MCPServers = {
  puppeteer: {
    command: 'npx',
    args: ['-y', '@tokenizin/mcp-npx-fetch'],
    env: {},
  },
  inspector: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/inspector'],
    env: {},
  },
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

      // Fetch MCP servers
      fetchMCPServers: async () => {
        set({ loading: true })

        // Simulate API call with mock data
        const response = await new Promise<MCPServers>((resolve) =>
          setTimeout(() => resolve(mockMCPServers), 0)
        )

        set((state) => {
          // Filter out deleted servers from the response
          const filteredResponse = { ...response }
          state.deletedServerKeys.forEach((key) => {
            delete filteredResponse[key]
          })

          const localKeys = Object.keys(state.mcpServers)
          const responseKeys = Object.keys(filteredResponse)

          // Check if the keys are the same
          const hasSameKeys =
            localKeys.length === responseKeys.length &&
            localKeys.every((key) => responseKeys.includes(key))

          // Check if values are the same for each key
          const hasSameValues =
            hasSameKeys &&
            localKeys.every((key) => {
              const current = state.mcpServers[key]
              const resp = filteredResponse[key]

              return (
                current.command === resp.command &&
                JSON.stringify(current.args) === JSON.stringify(resp.args) &&
                JSON.stringify(current.env) === JSON.stringify(resp.env)
              )
            })

          // If everything is the same, don't update
          if (hasSameValues) {
            return { loading: false }
          }

          // Add only new servers, preserving existing ones
          const existingKeys = new Set(localKeys)
          const newServers: MCPServers = {}

          responseKeys.forEach((key) => {
            if (!existingKeys.has(key)) {
              newServers[key] = filteredResponse[key]
            }
          })

          return {
            mcpServers: { ...newServers, ...state.mcpServers },
            loading: false,
          }
        })
      },
    }),
    {
      name: localStoregeKey.settingMCPSevers, // Using existing key for now
      storage: createJSONStorage(() => localStorage),
    }
  )
)
