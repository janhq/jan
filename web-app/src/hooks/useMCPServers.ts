import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

// Define the structure of an MCP server configuration
export type MCPServerConfig = {
  command: string
  args: string[]
  env: Record<string, string>
}

// Define the structure of all MCP servers
export type MCPServers = {
  [key: string]: MCPServerConfig
}

type MCPServerStoreState = {
  open: boolean
  mcpServers: MCPServers
  loading: boolean
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
      setLeftPanel: (value) => set({ open: value }),

      // Add a new MCP server or update if the key already exists
      addServer: (key, config) =>
        set((state) => ({
          mcpServers: {
            ...state.mcpServers,
            [key]: config,
          },
        })),

      // Edit an existing MCP server configuration
      editServer: (key, config) =>
        set((state) => {
          // Only proceed if the server exists
          if (!state.mcpServers[key]) return state

          return {
            mcpServers: {
              ...state.mcpServers,
              [key]: config,
            },
          }
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

          return { mcpServers: updatedServers }
        }),

      // Fetch MCP servers (simulated API call)
      fetchMCPServers: async () => {
        set({ loading: true })

        // Simulate API call with mock data
        const response = await new Promise<MCPServers>((resolve) =>
          setTimeout(() => resolve(mockMCPServers), 500)
        )

        set((state) => {
          // Check if the response is different from current state
          const currentKeys = Object.keys(state.mcpServers)
          const responseKeys = Object.keys(response)

          // Check if keys are the same
          const hasSameKeys =
            currentKeys.length === responseKeys.length &&
            currentKeys.every((key) => responseKeys.includes(key))

          // Check if values are the same for each key
          const hasSameValues =
            hasSameKeys &&
            currentKeys.every((key) => {
              const current = state.mcpServers[key]
              const resp = response[key]

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

          // Merge the response with existing servers
          // (In a real app, you might want to handle conflicts differently)
          return {
            mcpServers: { ...response, ...state.mcpServers },
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
