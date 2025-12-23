import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { JanMCPOAuthProvider } from './mcp-oauth-provider'
import { fetchWithAuth } from '@/lib/api-client'

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
export class StreamableHttpMCPClient implements ToolCallClient {
  private mcpEndpoint = 'mcp'
  private mcpClient: Client | null = null
  private oauthProvider: JanMCPOAuthProvider
  private apiUrl = JAN_API_BASE_URL
  private clientName = 'jan-app-client'

  constructor(clientName?: string, apiUrl?: string, mcpEndpoint?: string) {
    this.clientName = clientName ?? 'jan-app-client'
    this.apiUrl = apiUrl ?? JAN_API_BASE_URL
    this.mcpEndpoint = mcpEndpoint ?? 'mcp'
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
        new URL(`${this.apiUrl}${this.mcpEndpoint}`),
        {
          authProvider: this.oauthProvider,
          // No sessionId needed - server will generate one automatically
        }
      )

      // Create MCP client
      this.mcpClient = new Client(
        {
          name: this.clientName,
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
  async getTools(): Promise<MCPTool[]> {
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

      console.log(tools)

      return tools
    } catch (error) {
      console.error('Failed to fetch MCP tools:', error)
      throw error
    }
  }

  /**
   * Executes an MCP tool with the provided arguments
   * Makes a direct fetch call to the MCP endpoint with custom headers
   *
   * @param payload - Tool execution parameters
   * @param payload.toolName - Name of the tool to execute
   * @param payload.serverName - Optional server name (if multiple servers have same tool)
   * @param payload.arguments - Tool-specific arguments matching the tool's inputSchema
   * @param payload.conversationId - Optional conversation ID to include in headers
   * @param payload.toolCallId - Optional tool call ID to include in headers
   *
   * @returns Promise<MCPToolCallResult> - Tool execution result with content or error
   * @throws Error if the request fails
   *
   * @example
   * ```typescript
   * const result = await mcpService.callTool({
   *   toolName: 'web_search',
   *   serverName: 'Jan MCP Server',
   *   arguments: { query: 'latest AI news' },
   *   conversationId: 'conv-123',
   *   toolCallId: 'call-456'
   * })
   *
   * if (result.error) {
   *   console.error('Tool call failed:', result.error)
   * } else {
   *   console.log('Tool result:', result.content)
   * }
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
      // Check if already aborted
      if (metadata?.signal?.aborted) {
        return createErrorResult('Tool call was cancelled')
      }

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (metadata?.conversationId) {
        headers['X-Conversation-Id'] = metadata.conversationId
      }
      if (metadata?.toolCallId) {
        headers['X-Tool-Call-Id'] = metadata.toolCallId
      }

      // Build JSON-RPC request
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: payload.toolName,
          arguments: payload.arguments,
        },
      }

      console.log(`Calling MCP tool ${payload.toolName} with headers:`, headers)

      // Make fetch request with abort signal
      const response = await fetchWithAuth(
        `${JAN_API_BASE_URL}${this.mcpEndpoint}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(jsonRpcRequest),
          signal: metadata?.signal, // Pass abort signal to fetch
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return createErrorResult(
          `MCP tool call failed: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      // Handle both direct JSON and SSE responses
      const contentType = response.headers.get('content-type') || ''
      let result: any

      if (contentType.includes('text/event-stream')) {
        // Parse SSE response
        const text = await response.text()
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              result = JSON.parse(line.substring(6))
              break
            } catch (e) {
              console.warn('Failed to parse SSE line:', line)
            }
          }
        }
      } else {
        // Direct JSON response
        result = await response.json()
      }

      if (!result) {
        return createErrorResult('No valid response from MCP server')
      }

      // Check for JSON-RPC error
      if (result.error) {
        return createErrorResult(result.error.message || 'Tool call failed')
      }

      // Extract content from result
      const toolResult = result.result || result
      if (toolResult.isError) {
        const errorText =
          Array.isArray(toolResult.content) && toolResult.content.length > 0
            ? toolResult.content[0].type === 'text'
              ? toolResult.content[0].text
              : 'Tool call failed'
            : 'Tool call failed'
        return createErrorResult(errorText)
      }

      const content = Array.isArray(toolResult.content)
        ? toolResult.content.map((item: any) => item)
        : [{ type: 'text' as const, text: 'No content returned' }]

      console.log(`[MCP] Tool call succeeded:`, {
        toolName: payload.toolName,
        contentItems: content.length,
      })
      return { error: '', content }
    } catch (error) {
      // Handle abort errors separately
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`MCP tool call ${payload.toolName} was cancelled`)
        return createErrorResult('Tool call was cancelled')
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error(`Failed to call MCP tool ${payload.toolName}:`, error)

      return createErrorResult(errorMessage)
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
   * @returns Promise<MCPTool[]> - Updated list of tools
   */
  async refreshTools(): Promise<void> {}
}

/** Create an error result with the given message */
export const createErrorResult = (
  error: string,
  text?: string
): MCPToolCallResult => ({
  error,
  content: [{ type: 'text' as const, text: text || error }],
})
