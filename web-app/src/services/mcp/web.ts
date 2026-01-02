/**
 * Web MCP Service - Implementation for web platform
 * Uses the MCP extension through ExtensionManager
 * Follows OpenAI function calling standards
 */

import type { MCPServerConfig } from '@/hooks/useMCPServers'
import type { MCPService, MCPConfig, ToolCallWithCancellationResult } from './types'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension, MCPTool, MCPToolCallResult } from '@janhq/core'

export class WebMCPService implements MCPService {
  private abortControllers: Map<string, AbortController> = new Map()
  private extensionCache: MCPExtension | null = null
  private cacheTimestamp = 0
  private readonly CACHE_TTL = 5000 // 5 seconds

  private getMCPExtension(): MCPExtension | null {
    const now = Date.now()
    if (this.extensionCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.extensionCache
    }
    
    this.extensionCache = ExtensionManager.getInstance().get<MCPExtension>(
      ExtensionTypeEnum.MCP
    ) || null
    
    this.cacheTimestamp = now
    return this.extensionCache
  }

  private invalidateCache(): void {
    this.extensionCache = null
    this.cacheTimestamp = 0
  }

  async updateMCPConfig(configs: string): Promise<void> {
    if (!configs || typeof configs !== 'string') {
      throw new Error('Invalid MCP configuration provided')
    }
    // For web platform, configuration is handled by the remote API server
    // Invalidate cache to ensure fresh extension retrieval
    this.invalidateCache()
  }

  async restartMCPServers(): Promise<void> {
    // For web platform, servers are managed remotely
    // This triggers a refresh of available tools
    this.invalidateCache()
    const extension = this.getMCPExtension()
    if (extension) {
      try {
        await extension.refreshTools()
      } catch (error) {
        throw new Error(`Failed to restart MCP servers: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async getMCPConfig(): Promise<MCPConfig> {
    // Return empty config since web platform doesn't manage local MCP servers
    return {}
  }

  async getTools(): Promise<MCPTool[]> {
    const extension = this.getMCPExtension()
    if (!extension) {
      return []
    }
    
    try {
      return await extension.getTools()
    } catch (error) {
      console.error('Failed to get MCP tools:', error)
      return []
    }
  }

  async getConnectedServers(): Promise<string[]> {
    const extension = this.getMCPExtension()
    if (!extension) {
      return []
    }
    
    try {
      return await extension.getConnectedServers()
    } catch (error) {
      console.error('Failed to get connected servers:', error)
      return []
    }
  }

  async callTool(args: { toolName: string; arguments: object }): Promise<MCPToolCallResult> {
    // Validate input parameters
    if (!args.toolName || typeof args.toolName !== 'string') {
      return {
        error: 'Invalid tool name provided',
        content: [{ type: 'text', text: 'Tool name must be a non-empty string' }]
      }
    }

    const extension = this.getMCPExtension()
    if (!extension) {
      return {
        error: 'MCP extension not available',
        content: [{ type: 'text', text: 'MCP service is not available' }]
      }
    }

    try {
      const result = await extension.callTool(args.toolName, args.arguments as Record<string, unknown>)
      
      // Ensure OpenAI-compliant response format
      if (!result.content || !Array.isArray(result.content)) {
        return {
          error: 'Invalid tool response format',
          content: [{ type: 'text', text: 'Tool returned invalid response format' }]
        }
      }

      return {
        error: result.error || '',
        content: result.content.map(item => ({
          type: item.type || 'text',
          text: item.text || JSON.stringify(item)
        }))
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        error: errorMessage,
        content: [{ type: 'text', text: `Tool execution failed: ${errorMessage}` }]
      }
    }
  }

  callToolWithCancellation(args: {
    toolName: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult {
    // Validate input parameters
    if (!args.toolName || typeof args.toolName !== 'string') {
      const errorResult: MCPToolCallResult = {
        error: 'Invalid tool name provided',
        content: [{ type: 'text', text: 'Tool name must be a non-empty string' }]
      }
      return {
        promise: Promise.resolve(errorResult),
        cancel: async () => {}, // No-op for failed validation
        token: 'invalid'
      }
    }

    const token = args.cancellationToken || this.generateCancellationToken()
    const abortController = new AbortController()
    this.abortControllers.set(token, abortController)

    const promise = this.callToolWithAbort(args, abortController.signal)
      .finally(() => {
        this.abortControllers.delete(token)
      })

    return {
      promise,
      cancel: async () => {
        const controller = this.abortControllers.get(token)
        if (controller && !controller.signal.aborted) {
          controller.abort()
        }
        this.abortControllers.delete(token)
      },
      token
    }
  }

  private async callToolWithAbort(
    args: { toolName: string; arguments: object },
    signal: AbortSignal
  ): Promise<MCPToolCallResult> {
    // Check if already aborted
    if (signal.aborted) {
      return {
        error: 'Tool call was cancelled',
        content: [{ type: 'text', text: 'Tool call was cancelled by user' }]
      }
    }

    const extension = this.getMCPExtension()
    if (!extension) {
      return {
        error: 'MCP extension not available',
        content: [{ type: 'text', text: 'MCP service is not available' }]
      }
    }

    return new Promise((resolve) => {
      const abortHandler = () => {
        resolve({
          error: 'Tool call was cancelled',
          content: [{ type: 'text', text: 'Tool call was cancelled by user' }]
        })
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      extension.callTool(args.toolName, args.arguments as Record<string, unknown>)
        .then(result => {
          if (!signal.aborted) {
            if (!result.content || !Array.isArray(result.content)) {
              resolve({
                error: 'Invalid tool response format',
                content: [{ type: 'text', text: 'Tool returned invalid response format' }]
              })
              return
            }

            resolve({
              error: result.error || '',
              content: result.content.map(item => ({
                type: item.type || 'text',
                text: item.text || JSON.stringify(item)
              }))
            })
          }
        })
        .catch(error => {
          if (!signal.aborted) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            resolve({
              error: errorMessage,
              content: [{ type: 'text', text: `Tool execution failed: ${errorMessage}` }]
            })
          }
        })
        .finally(() => {
          signal.removeEventListener('abort', abortHandler)
        })
    })
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    const controller = this.abortControllers.get(cancellationToken)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(cancellationToken)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async activateMCPServer(name: string, _config: MCPServerConfig): Promise<void> {
    // For web platform, server activation is handled remotely
    this.invalidateCache()
    const extension = this.getMCPExtension()
    if (extension) {
      try {
        await extension.refreshTools()
      } catch (error) {
        throw new Error(`Failed to activate MCP server ${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async deactivateMCPServer(name: string): Promise<void> {
    // For web platform, server deactivation is handled remotely
    this.invalidateCache()
    const extension = this.getMCPExtension()
    if (extension) {
      try {
        await extension.refreshTools()
      } catch (error) {
        throw new Error(`Failed to deactivate MCP server ${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async checkJanBrowserExtensionConnected(): Promise<boolean> {
    // Jan Browser Extension is not supported on web platform
    return false
  }

  private generateCancellationToken(): string {
    return `mcp_cancel_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  }
}
