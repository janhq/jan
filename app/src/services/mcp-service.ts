import { JanBrowserClient } from '@/lib/jan-browser-client'
import { StreamableHttpMCPClient } from '@/lib/streamable-mcp-client'
import { useBrowserConnection } from '@/stores/browser-connection-store'
import { createJanMediaUrl, uploadMedia } from './media-upload-service'
import { CONTENT_TYPE } from '@/constants'

/**
 * MCP Service - Registry for managing multiple MCP clients
 *
 * This service acts as a central registry for MCP clients:
 * - Maintains a map of MCP clients keyed by endpoint identifier
 * - Provides methods to register, retrieve, and manage multiple clients
 * - Aggregates tools and calls from all registered clients
 * - Handles client lifecycle (initialization, health checks, cleanup)
 */
class MCPService {
  private clients: Map<string, ToolCallClient> = new Map()
  private defaultClientKey = 'default'

  constructor() {
    // Initialize with default client
    this.initializeMCPClient()
    // Register default clients
    this.registerClient('search', new StreamableHttpMCPClient())

    // Register browser client and connect it to the store
    const browserClient = new JanBrowserClient()
    browserClient.setOnStateChange((state) => {
      useBrowserConnection.getState().setConnectionState(state)
    })
    this.registerClient('browse', browserClient)
  }

  /**
   * Initializes the default MCP client
   * Creates a client connection to the default MCP endpoint
   *
   * @throws Error if client initialization fails
   */
  private async initializeMCPClient(): Promise<void> {
    try {
      const defaultClient = new StreamableHttpMCPClient()
      this.clients.set(this.defaultClientKey, defaultClient)
      console.log('Default MCP client initialized')
    } catch (error) {
      console.error('Failed to initialize default MCP client:', error)
      throw error
    }
  }

  /**
   * Registers a new MCP client with a custom endpoint
   *
   * @param key - Unique identifier for this client
   * @param apiUrl - Base API URL for the MCP server
   * @param mcpEndpoint - MCP endpoint path (default: 'mcp')
   * @returns The registered client instance
   *
   * @example
   * ```typescript
   * const client = mcpService.registerClient(
   *   'custom-server',
   *   'http://localhost:8080',
   *   'mcp'
   * )
   * ```
   */
  registerClient(key: string, client: ToolCallClient): ToolCallClient {
    if (this.clients.has(key)) {
      console.warn(`MCP client with key "${key}" already exists, replacing it`)
    }

    this.clients.set(key, client)
    console.log(`Registered MCP client: ${key}`)
    return client
  }

  /**
   * Gets an MCP client by key
   *
   * @param key - Client identifier (defaults to 'default')
   * @returns The client instance or undefined if not found
   */
  getClient(key: string = this.defaultClientKey): ToolCallClient | undefined {
    return this.clients.get(key)
  }

  /**
   * Removes a client from the registry and disconnects it
   *
   * @param key - Client identifier
   * @returns true if client was found and removed, false otherwise
   */
  async unregisterClient(key: string): Promise<boolean> {
    const client = this.clients.get(key)
    if (!client) {
      return false
    }

    await client.disconnect()
    this.clients.delete(key)
    console.log(`Unregistered MCP client: ${key}`)
    return true
  }

  /**
   * Gets all registered client keys
   *
   * @returns Array of client identifiers
   */
  getClientKeys(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Ensures the default MCP client is initialized and connected
   * @throws Error if initialization fails
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.clients.has(this.defaultClientKey)) {
      await this.initializeMCPClient()
    }
  }

  /**
   * Fetches all available MCP tools from all connected servers
   * Aggregates tools from all registered clients
   *
   * @returns Promise<GetToolsResponse> - Combined list of tools from all clients
   * @throws Error if the request fails
   *
   * @example
   * ```typescript
   * const response = await mcpService.getTools()
   * console.log(response.data) // Array of MCPTool objects from all servers
   * ```
   */
  async getTools(servers?: string[]): Promise<GetToolsResponse> {
    try {
      await this.ensureInitialized()

      const allTools: MCPTool[] = []

      // Fetch tools from all registered clients
      for (const [key, client] of this.clients.entries()) {
        try {
          if (servers && servers.length > 0 && !servers.includes(key)) {
            continue
          }
          const response = await client.getTools()
          // Tag tools with their source client for routing calls later
          const taggedTools = response.map((tool) => ({
            ...tool,
            server: tool.server || key,
          }))
          allTools.push(...taggedTools)
          console.log(`Fetched ${taggedTools.length} tools from client: ${key}`)
        } catch (error) {
          console.error(`Failed to fetch tools from client ${key}:`, error)
        }
      }

      console.log(`Total MCP tools aggregated: ${allTools.length}`)

      return {
        object: 'list',
        data: allTools,
      }
    } catch (error) {
      console.error('Failed to fetch MCP tools:', error)
      throw error
    }
  }

  /**
   * Executes an MCP tool with the provided arguments
   * Searches for the tool across all registered clients and routes the call automatically
   *
   * @param payload - Tool execution parameters
   * @param payload.toolName - Name of the tool to execute
   * @param payload.serverName - Optional: specific server name to use (if not provided, will search)
   * @param payload.arguments - Tool-specific arguments matching the tool's inputSchema
   * @param metadata - Optional metadata (conversationId, toolCallId)
   *
   * @returns Promise<MCPToolCallResult> - Tool execution result with content or error
   * @throws Error if the request fails
   *
   * @example
   * ```typescript
   * // Automatic tool search across all clients
   * const result = await mcpService.callTool({
   *   toolName: 'web_search',
   *   arguments: { query: 'latest AI news' }
   * }, {
   *   conversationId: 'conv-123',
   *   toolCallId: 'call-456'
   * })
   *
   * // Or specify a specific server
   * const result = await mcpService.callTool({
   *   toolName: 'web_search',
   *   serverName: 'custom-server',
   *   arguments: { query: 'latest AI news' }
   * })
   * ```
   */
  async callTool(
    payload: CallToolPayload,
    metadata?: {
      conversationId?: string
      toolCallId?: string
      signal?: AbortSignal
    }
  ): Promise<MCPToolCallResult> {
    try {
      await this.ensureInitialized()

      let targetClient: ToolCallClient | undefined
      let targetClientKey: string | undefined

      // If no client found yet, search for the tool across all clients
      if (!targetClient) {
        console.log(
          `Searching for tool "${payload.toolName}" across ${this.clients.size} registered clients...`
        )

        for (const [key, client] of this.clients.entries()) {
          try {
            const response = await client.getTools()
            const hasTool = response.some(
              (tool) => tool.name === payload.toolName
            )

            if (hasTool) {
              targetClient = client
              targetClientKey = key
              console.log(`Found tool "${payload.toolName}" in client: ${key}`)
              break
            }
          } catch (error) {
            console.warn(`Error searching for tool in client ${key}:`, error)
            // Continue searching in other clients
          }
        }
      }

      // If still no client found, return error
      if (!targetClient || !targetClientKey) {
        return createErrorResult(
          `Tool not found: ${payload.toolName}`,
          `Tool "${payload.toolName}" is not available in any registered MCP client`
        )
      }

      // Route the call to the appropriate client
      console.log(
        `Routing tool call "${payload.toolName}" to client: ${targetClientKey}`
      )

      // Check if already aborted before calling
      if (metadata?.signal?.aborted) {
        return createErrorResult('Tool call was cancelled')
      }

      return await targetClient
        .callTool(payload, metadata)
        .then(async (toolResult) => {
          console.log(
            `Tool "${payload.toolName}" executed successfully on client: ${targetClientKey}`,
            toolResult
          )
          if (toolResult.error) {
            return createErrorResult(toolResult.error)
          }

          // Process content to upload images and convert to Jan media URLs
          const processedContent = await Promise.all(
            toolResult.content.map(async (item) => {
              // Check if this is an image with base64 data
              if (item.type === 'image' && item.data && item.mimeType) {
                try {
                  // Add base64 prefix if not present
                  let dataUrl = item.data
                  if (!dataUrl.startsWith('data:')) {
                    dataUrl = `data:${item.mimeType};base64,${item.data}`
                  }

                  // Upload to media service
                  const uploadResponse = await uploadMedia(
                    dataUrl,
                    'mcp-image',
                    metadata?.conversationId || 'anonymous'
                  )

                  // Convert to Jan media URL format
                  const janMediaUrl = createJanMediaUrl(
                    uploadResponse.id,
                    uploadResponse.mime
                  )

                  // Return updated item with Jan media URL
                  return {
                    ...item,
                    data: janMediaUrl,
                  }
                } catch (uploadError) {
                  console.error('Failed to upload MCP image:', uploadError)
                  // Keep original data if upload fails
                  return item
                }
              }
              return item
            })
          )
          return {
            error: toolResult.error,
            content: processedContent,
          }
        })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error(`Failed to call MCP tool ${payload.toolName}:`, error)

      return createErrorResult(errorMessage)
    }
  }

  /**
   * Checks if all MCP clients are healthy and connected
   * @returns Promise<boolean> - true if all clients are operational
   */
  async isHealthy(): Promise<boolean> {
    if (this.clients.size === 0) {
      return false
    }

    const healthChecks = await Promise.all(
      Array.from(this.clients.values()).map((client) => client.isHealthy())
    )

    return healthChecks.every((isHealthy) => isHealthy)
  }

  /**
   * Checks health of a specific client
   * @param key - Client identifier
   * @returns Promise<boolean> - true if client is operational
   */
  async isClientHealthy(key: string): Promise<boolean> {
    const client = this.clients.get(key)
    if (!client) {
      return false
    }

    return await client.isHealthy()
  }

  /**
   * Closes all MCP client connections and cleans up resources
   */
  async disconnect(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.entries()).map(
      async ([key, client]) => {
        try {
          await client.disconnect()
          console.log(`Disconnected MCP client: ${key}`)
        } catch (error) {
          console.error(`Error disconnecting client ${key}:`, error)
        }
      }
    )

    await Promise.all(disconnectPromises)
    this.clients.clear()
    console.log('All MCP clients disconnected')
  }

  /**
   * Disconnects a specific client
   * @param key - Client identifier
   */
  async disconnectClient(key: string): Promise<void> {
    const client = this.clients.get(key)
    if (client) {
      await client.disconnect()
      console.log(`Disconnected MCP client: ${key}`)
    }
  }

  /**
   * Refreshes the tools list by re-fetching from all servers
   * Reconnects all clients to get fresh data
   * @returns Promise<void> - Updated list of tools
   */
  async refreshTools(): Promise<void> {
    const refreshPromises = Array.from(this.clients.values()).map((client) =>
      client.refreshTools().catch((error) => {
        console.error('Error refreshing client tools:', error)
        return { object: 'list', data: [] }
      })
    )

    await Promise.all(refreshPromises)
  }
}

/** Create an error result with the given message */
export const createErrorResult = (
  error: string,
  text?: string
): MCPToolCallResult => ({
  error,
  content: [{ type: CONTENT_TYPE.TEXT, text: text || error }],
})

// Export singleton instance
export const mcpService = new MCPService()
