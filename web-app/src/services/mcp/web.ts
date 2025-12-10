/**
 * Web MCP Service - Implementation for web platform
 * Uses the MCP extension through ExtensionManager
 * Follows OpenAI function calling standards
 */

import type { MCPServerConfig } from '@/hooks/useMCPServers'
import type { MCPService, MCPConfig, ToolCallWithCancellationResult } from './types'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension, MCPTool, MCPToolCallResult, MCPToolCallResultContent } from '@janhq/core'

/** Create an error result with the given message */
const createErrorResult = (error: string, text?: string): MCPToolCallResult => ({
  error,
  content: [{ type: 'text' as const, text: text || error }]
})

/** Normalize content item to proper MCPToolCallResultContent type */
const normalizeContentItem = (item: { type?: string; text?: string; data?: string; mimeType?: string }): MCPToolCallResultContent => {
  if (item.type === 'image' && item.data && item.mimeType) {
    return { type: 'image' as const, data: item.data, mimeType: item.mimeType }
  }
  return { type: 'text' as const, text: item.text || JSON.stringify(item) }
}

/** Normalize tool call result content array */
const normalizeResult = (result: { error?: string; content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }> }): MCPToolCallResult => ({
  error: result.error || '',
  content: (result.content || []).map(normalizeContentItem)
})

export class WebMCPService implements MCPService {
  private abortControllers: Map<string, AbortController> = new Map()
  private extensionsCache: MCPExtension[] | null = null
  private cacheTimestamp = 0
  private readonly CACHE_TTL = 5000 // 5 seconds

  /**
   * Get all MCP extensions (supports multiple extensions like mcp-web and mcp-browser)
   */
  private getMCPExtensions(): MCPExtension[] {
    const now = Date.now()
    if (this.extensionsCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.extensionsCache
    }

    // Get all extensions with MCP type
    this.extensionsCache = ExtensionManager.getInstance()
      .getAll()
      .filter(e => e.type() === ExtensionTypeEnum.MCP) as MCPExtension[]

    this.cacheTimestamp = now
    return this.extensionsCache
  }

  /**
   * Find the extension that owns a specific tool by server name
   * Uses cached tool list to find the right extension
   */
  private async findExtensionForServer(serverName?: string): Promise<MCPExtension | null> {
    const extensions = this.getMCPExtensions()
    if (extensions.length === 0) return null
    if (!serverName) return extensions[0] || null

    // Find extension that owns this server
    for (const ext of extensions) {
      try {
        const servers = await ext.getConnectedServers()
        if (servers.includes(serverName)) {
          return ext
        }
      } catch {
        // Continue checking other extensions
      }
    }

    // Fallback to first extension
    return extensions[0] || null
  }

  private invalidateCache(): void {
    this.extensionsCache = null
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
    // This triggers a refresh of available tools on all MCP extensions
    this.invalidateCache()
    const extensions = this.getMCPExtensions()
    const errors: string[] = []

    await Promise.all(
      extensions.map(async (extension) => {
        try {
          await extension.refreshTools()
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      })
    )

    if (errors.length > 0) {
      throw new Error(`Failed to restart MCP servers: ${errors.join(', ')}`)
    }
  }

  async getMCPConfig(): Promise<MCPConfig> {
    // Return empty config since web platform doesn't manage local MCP servers
    return {}
  }

  async getTools(): Promise<MCPTool[]> {
    const extensions = this.getMCPExtensions()
    if (extensions.length === 0) {
      return []
    }

    try {
      // Aggregate tools from all MCP extensions
      const toolArrays = await Promise.all(
        extensions.map(ext => ext.getTools().catch((error) => {
          console.warn('Failed to get tools from extension:', error)
          return [] as MCPTool[]
        }))
      )
      return toolArrays.flat()
    } catch (error) {
      console.error('Failed to get MCP tools:', error)
      return []
    }
  }

  async getConnectedServers(): Promise<string[]> {
    const extensions = this.getMCPExtensions()
    if (extensions.length === 0) {
      return []
    }

    try {
      // Aggregate connected servers from all MCP extensions
      const serverArrays = await Promise.all(
        extensions.map(ext => ext.getConnectedServers().catch((error) => {
          console.warn('Failed to get connected servers from extension:', error)
          return [] as string[]
        }))
      )
      return serverArrays.flat()
    } catch (error) {
      console.error('Failed to get connected servers:', error)
      return []
    }
  }

  async callTool(args: { toolName: string; serverName?: string; arguments: object }): Promise<MCPToolCallResult> {
    if (!args.toolName || typeof args.toolName !== 'string') {
      return createErrorResult('Invalid tool name provided', 'Tool name must be a non-empty string')
    }

    const extension = await this.findExtensionForServer(args.serverName)
    if (!extension) {
      return createErrorResult('MCP extension not available', 'MCP service is not available')
    }

    try {
      const result = await extension.callTool(args.toolName, args.arguments as Record<string, unknown>, args.serverName)

      if (!result.content || !Array.isArray(result.content)) {
        return createErrorResult('Invalid tool response format', 'Tool returned invalid response format')
      }

      return normalizeResult(result)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return createErrorResult(errorMessage, `Tool execution failed: ${errorMessage}`)
    }
  }

  callToolWithCancellation(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult {
    if (!args.toolName || typeof args.toolName !== 'string') {
      return {
        promise: Promise.resolve(createErrorResult('Invalid tool name provided', 'Tool name must be a non-empty string')),
        cancel: async () => {},
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
    args: { toolName: string; serverName?: string; arguments: object },
    signal: AbortSignal
  ): Promise<MCPToolCallResult> {
    const cancelledResult = createErrorResult('Tool call was cancelled', 'Tool call was cancelled by user')

    if (signal.aborted) {
      return cancelledResult
    }

    const extension = await this.findExtensionForServer(args.serverName)
    if (!extension) {
      return createErrorResult('MCP extension not available', 'MCP service is not available')
    }

    return new Promise((resolve) => {
      const abortHandler = () => resolve(cancelledResult)
      signal.addEventListener('abort', abortHandler, { once: true })

      extension.callTool(args.toolName, args.arguments as Record<string, unknown>, args.serverName)
        .then(result => {
          if (!signal.aborted) {
            if (!result.content || !Array.isArray(result.content)) {
              resolve(createErrorResult('Invalid tool response format', 'Tool returned invalid response format'))
              return
            }
            resolve(normalizeResult(result))
          }
        })
        .catch(error => {
          if (!signal.aborted) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            resolve(createErrorResult(errorMessage, `Tool execution failed: ${errorMessage}`))
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
    // Refresh all MCP extensions to ensure all tool lists are up to date
    this.invalidateCache()
    const extensions = this.getMCPExtensions()
    const errors: string[] = []

    await Promise.all(
      extensions.map(async (extension) => {
        try {
          await extension.refreshTools()
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      })
    )

    if (errors.length > 0) {
      throw new Error(`Failed to activate MCP server ${name}: ${errors.join(', ')}`)
    }
  }

  async deactivateMCPServer(name: string): Promise<void> {
    // For web platform, server deactivation is handled remotely
    // Refresh all MCP extensions to ensure all tool lists are up to date
    this.invalidateCache()
    const extensions = this.getMCPExtensions()
    const errors: string[] = []

    await Promise.all(
      extensions.map(async (extension) => {
        try {
          await extension.refreshTools()
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      })
    )

    if (errors.length > 0) {
      throw new Error(`Failed to deactivate MCP server ${name}: ${errors.join(', ')}`)
    }
  }

  private generateCancellationToken(): string {
    return `mcp_cancel_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  }
}
