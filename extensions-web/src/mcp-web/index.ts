/**
 * MCP Web Extension
 * Provides Model Context Protocol functionality for web platform
 * Uses official MCP TypeScript SDK with proper session handling
 */

import { MCPExtension, MCPTool, MCPToolCallResult, MCPToolComponentProps } from '@janhq/core'
import { getSharedAuthService, JanAuthService } from '../shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { JanMCPOAuthProvider } from './oauth-provider'
import { WebSearchButton } from './components'
import type { ComponentType } from 'react'

// JAN_BASE_URL is defined in vite.config.ts (defaults to 'https://api-dev.jan.ai/v1')
declare const JAN_BASE_URL: string

export default class MCPExtensionWeb extends MCPExtension {
  private mcpEndpoint = '/mcp'
  private tools: MCPTool[] = []
  private initialized = false
  private authService: JanAuthService
  private mcpClient: Client | null = null
  private oauthProvider: JanMCPOAuthProvider

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    super(url, name, productName, active, description, version)
    this.authService = getSharedAuthService()
    this.oauthProvider = new JanMCPOAuthProvider(this.authService)
  }

  async onLoad(): Promise<void> {
    try {
      // Initialize MCP client with OAuth
      await this.initializeMCPClient()
      // Then fetch tools
      await this.initializeTools()
    } catch (error) {
      console.warn('Failed to initialize MCP extension:', error)
      this.tools = []
    }
  }

  async onUnload(): Promise<void> {
    this.tools = []
    this.initialized = false
    
    // Close MCP client
    if (this.mcpClient) {
      try {
        await this.mcpClient.close()
      } catch (error) {
        console.warn('Error closing MCP client:', error)
      }
      this.mcpClient = null
    }
  }

  private async initializeMCPClient(): Promise<void> {
    try {
      // Close existing client if any
      if (this.mcpClient) {
        try {
          await this.mcpClient.close()
        } catch (error) {
          // Ignore close errors
        }
        this.mcpClient = null
      }

      // Create transport with OAuth provider (handles token refresh automatically)
      const transport = new StreamableHTTPClientTransport(
        new URL(`${JAN_BASE_URL}${this.mcpEndpoint}`),
        {
          authProvider: this.oauthProvider
          // No sessionId needed - server will generate one automatically
        }
      )
      
      // Create MCP client
      this.mcpClient = new Client(
        {
          name: 'jan-web-client',
          version: '1.0.0'
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            logging: {}
          }
        }
      )
      
      // Connect to MCP server (OAuth provider handles auth automatically)
      await this.mcpClient.connect(transport)
      
      console.log('MCP client connected successfully, session ID:', transport.sessionId)
    } catch (error) {
      console.error('Failed to initialize MCP client:', error)
      throw error
    }
  }

  private async initializeTools(): Promise<void> {
    if (this.initialized || !this.mcpClient) {
      return
    }

    try {
      // Use MCP SDK to list tools
      const result = await this.mcpClient.listTools()
      console.log('MCP tools/list response:', result)
      
      if (result.tools && Array.isArray(result.tools)) {
        this.tools = result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: (tool.inputSchema || {}) as Record<string, unknown>,
          server: 'Jan MCP Server'
        }))
      } else {
        console.warn('No tools found in MCP server response')
        this.tools = []
      }

      this.initialized = true
      console.log(`Initialized MCP extension with ${this.tools.length} tools:`, this.tools.map(t => t.name))
    } catch (error) {
      console.error('Failed to fetch MCP tools:', error)
      this.tools = []
      this.initialized = false
      throw error
    }
  }

  async getTools(): Promise<MCPTool[]> {
    if (!this.initialized) {
      await this.initializeTools()
    }
    return this.tools
  }

  async callTool(toolName: string, args: Record<string, unknown>, serverName?: string): Promise<MCPToolCallResult> {
    if (!this.mcpClient) {
      return {
        error: 'MCP client not initialized',
        content: [{ type: 'text', text: 'MCP client not initialized' }]
      }
    }

    try {
      // Use MCP SDK to call tool (OAuth provider handles auth automatically)
      const result = await this.mcpClient.callTool({
        name: toolName,
        arguments: args
      })
      
      console.log(`MCP tool call result for ${toolName}:`, result)
      
      // Handle tool call result
      if (result.isError) {
        const errorText = Array.isArray(result.content) && result.content.length > 0
          ? (result.content[0].type === 'text' ? (result.content[0] as any).text : 'Tool call failed')
          : 'Tool call failed'
        
        return {
          error: errorText,
          content: [{ type: 'text', text: errorText }]
        }
      }

      // Convert MCP content to Jan's format
      const content = Array.isArray(result.content) 
        ? result.content.map(item => {
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
        content
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Failed to call MCP tool ${toolName}:`, error)
      
      return {
        error: errorMessage,
        content: [{ type: 'text', text: errorMessage }]
      }
    }
  }

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

  async getConnectedServers(): Promise<string[]> {
    // Return servers based on MCP client connection status
    return this.mcpClient && this.initialized ? ['Jan MCP Server'] : []
  }

  async refreshTools(): Promise<void> {
    this.initialized = false
    try {
      await this.initializeTools()
    } catch (error) {
      console.error('Failed to refresh tools:', error)
      throw error
    }
  }

  /**
   * Provides a custom UI component for web search tools
   * @returns The WebSearchButton component
   */
  getToolComponent(): ComponentType<MCPToolComponentProps> | null {
    return WebSearchButton
  }

  /**
   * Returns the list of tool keys (server::tool format) that should be disabled by default for new users
   * All MCP web tools are disabled by default to prevent accidental API usage
   * @returns Array of tool keys (server::tool) to disable by default
   */
  async getDefaultDisabledTools(): Promise<string[]> {
    try {
      const tools = await this.getTools()
      return tools.map(tool => `${tool.server}::${tool.name}`)
    } catch (error) {
      console.error('Failed to get default disabled tools:', error)
      return []
    }
  }
}
