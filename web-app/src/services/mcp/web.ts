/**
 * Web MCP Service - Web implementation
 */

import { MCPTool } from '@/types/completion'
import type { MCPService, ToolCallResult, ToolCallWithCancellationResult } from './types'

export class WebMCPService implements MCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    await window.core?.api?.saveMcpConfigs({ configs })
  }

  async restartMCPServers(): Promise<void> {
    await window.core?.api?.restartMcpServers()
  }

  async getMCPConfig(): Promise<object> {
    const configString = (await window.core?.api?.getMcpConfigs()) ?? '{}'
    const mcpConfig = JSON.parse(configString || '{}')
    return mcpConfig
  }

  async getTools(): Promise<MCPTool[]> {
    return await window.core?.api?.getTools() ?? []
  }

  async getConnectedServers(): Promise<string[]> {
    return await window.core?.api?.getConnectedServers() ?? []
  }

  async callTool(args: { toolName: string; arguments: object }): Promise<ToolCallResult> {
    return await window.core?.api?.callTool(args) ?? { error: 'API not available', content: [] }
  }

  callToolWithCancellation(args: {
    toolName: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult {
    // Generate a unique cancellation token if not provided
    const token = args.cancellationToken ?? `tool_call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Create the tool call promise with cancellation token
    const promise = window.core?.api?.callTool({
      ...args,
      cancellationToken: token
    }) ?? Promise.resolve({ error: 'API not available', content: [] })
    
    // Create cancel function
    const cancel = async () => {
      await window.core?.api?.cancelToolCall({ cancellationToken: token })
    }
    
    return { promise, cancel, token }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    await window.core?.api?.cancelToolCall({ cancellationToken })
  }

  // MCP Server lifecycle management - web fallbacks
  async activateMCPServer(name: string, config: import('@/hooks/useMCPServers').MCPServerConfig): Promise<void> {
    console.warn(`MCP server activation not available in web environment: ${name}`, config)
  }

  async deactivateMCPServer(name: string): Promise<void> {
    console.warn(`MCP server deactivation not available in web environment: ${name}`)
  }
}