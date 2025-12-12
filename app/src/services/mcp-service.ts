import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { JanMCPOAuthProvider } from './mcp-oauth-provider'

declare const JAN_API_BASE_URL: string

/**
 * MCP Service - Provides Model Context Protocol functionality
 *
 * This service integrates with the MCP backend using the official MCP SDK:
 * - Uses StreamableHTTPClientTransport for HTTP communication
 * - Handles OAuth authentication automatically via JanMCPOAuthProvider
 * - Fetches available MCP tools from connected servers
 * - Executes tool calls with proper session handling
 */
class MCPService {
  private mcpEndpoint = 'mcp'
  private mcpClient: Client | null = null
  private oauthProvider: JanMCPOAuthProvider

  constructor() {
    this.oauthProvider = new JanMCPOAuthProvider()
  }

  /**
   * Initializes the MCP client with OAuth authentication
   * Creates a new client connection with StreamableHTTPClientTransport
   *
   * @throws Error if client initialization fails
   */
  private async initializeMCPClient(): Promise<void> {
    try {
      // Close existing client if any
      if (this.mcpClient) {
        try {
          await this.mcpClient.close()
        } catch (error) {
          console.warn('Error closing existing MCP client:', error)
        }
        this.mcpClient = null
      }

      // Create transport with OAuth provider (handles token refresh automatically)
      const transport = new StreamableHTTPClientTransport(
        new URL(`${JAN_API_BASE_URL}${this.mcpEndpoint}`),
        {
          authProvider: this.oauthProvider,
          // No sessionId needed - server will generate one automatically
        }
      )

      // Create MCP client
      this.mcpClient = new Client(
        {
          name: 'jan-app-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      )

      // Connect to MCP server (OAuth provider handles auth automatically)
      await this.mcpClient.connect(transport)

      console.log(
        'MCP client connected successfully, session ID:',
        transport.sessionId
      )
    } catch (error) {
      console.error('Failed to initialize MCP client:', error)
      throw error
    }
  }

  /**
   * Ensures the MCP client is initialized and connected
   * @throws Error if initialization fails
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.mcpClient) {
      await this.initializeMCPClient()
    }
  }

  /**
   * Fetches all available MCP tools from connected servers
   * Uses MCP SDK's listTools() method
   *
   * @returns Promise<GetToolsResponse> - List of available tools with metadata
   * @throws Error if the request fails
   *
   * @example
   * ```typescript
   * const response = await mcpService.getTools()
   * console.log(response.data) // Array of MCPTool objects
   * ```
   */
  async getTools(): Promise<GetToolsResponse> {
    try {
      await this.ensureInitialized()

      if (!this.mcpClient) {
        throw new Error('MCP client not initialized')
      }

      // Use MCP SDK to list tools
      const result = await this.mcpClient.listTools()
      console.log('MCP tools/list response:', result)

      let tools: MCPTool[] = []

      if (result.tools && Array.isArray(result.tools)) {
        tools = result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: (tool.inputSchema || {}) as Record<string, unknown>,
          server: 'Jan MCP Server',
        }))
      } else {
        console.warn('No tools found in MCP server response')
      }

      console.log(
        `Fetched ${tools.length} MCP tools:`,
        tools.map((t) => t.name)
      )

      return {
        object: 'list',
        data: tools,
      }
    } catch (error) {
      console.error('Failed to fetch MCP tools:', error)
      throw error
    }
  }

  /**
   * Executes an MCP tool with the provided arguments
   * Uses MCP SDK's callTool() method
   *
   * @param payload - Tool execution parameters
   * @param payload.toolName - Name of the tool to execute
   * @param payload.serverName - Optional server name (if multiple servers have same tool)
   * @param payload.arguments - Tool-specific arguments matching the tool's inputSchema
   *
   * @returns Promise<MCPToolCallResult> - Tool execution result with content or error
   * @throws Error if the request fails
   *
   * @example
   * ```typescript
   * const result = await mcpService.callTool({
   *   toolName: 'web_search',
   *   serverName: 'Jan MCP Server',
   *   arguments: { query: 'latest AI news' }
   * })
   *
   * if (result.error) {
   *   console.error('Tool call failed:', result.error)
   * } else {
   *   console.log('Tool result:', result.content)
   * }
   * ```
   */
  async callTool(payload: CallToolPayload): Promise<MCPToolCallResult> {
    try {
      await this.ensureInitialized()

      if (!this.mcpClient) {
        return {
          error: 'MCP client not initialized',
          content: [{ type: 'text', text: 'MCP client not initialized' }],
        }
      }

      // Use MCP SDK to call tool (OAuth provider handles auth automatically)
      const result = await this.mcpClient.callTool({
        name: payload.toolName,
        arguments: payload.arguments,
      })

      console.log(`MCP tool call result for ${payload.toolName}:`, result)

      // Handle tool call result
      if (result.isError) {
        const errorText =
          Array.isArray(result.content) && result.content.length > 0
            ? result.content[0].type === 'text'
              ? (result.content[0] as any).text
              : 'Tool call failed'
            : 'Tool call failed'

        return {
          error: errorText,
          content: [{ type: 'text', text: errorText }],
        }
      }

      // Convert MCP content to Jan's format
      const content = Array.isArray(result.content)
        ? result.content.map((item) => {
            if (item.type === 'text') {
              return { type: 'text' as const, text: (item as any).text }
            } else {
              // For non-text types, convert to text representation
              return { type: 'text' as const, text: JSON.stringify(item) }
            }
          })
        : [{ type: 'text' as const, text: 'No content returned' }]

      return {
        error: '',
        content,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Failed to call MCP tool ${payload.toolName}:`, error)

      return {
        error: errorMessage,
        content: [{ type: 'text', text: errorMessage }],
      }
    }
  }

  /**
   * Checks if the MCP client is healthy and connected
   * @returns Promise<boolean> - true if client is connected and operational
   */
  async isHealthy(): Promise<boolean> {
    if (!this.mcpClient) {
      return false
    }

    try {
      // Try to list tools as health check (OAuth provider handles auth)
      await this.mcpClient.listTools()
      return true
    } catch (error) {
      console.warn('MCP health check failed:', error)
      return false
    }
  }

  /**
   * Closes the MCP client connection and cleans up resources
   */
  async disconnect(): Promise<void> {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close()
      } catch (error) {
        console.warn('Error closing MCP client:', error)
      }
      this.mcpClient = null
    }
  }

  /**
   * Refreshes the tools list by re-fetching from the server
   * Reinitializes the client to get fresh data
   * @returns Promise<GetToolsResponse> - Updated list of tools
   */
  async refreshTools(): Promise<GetToolsResponse> {
    await this.disconnect()
    return this.getTools()
  }
}

// Export singleton instance
export const mcpService = new MCPService()
