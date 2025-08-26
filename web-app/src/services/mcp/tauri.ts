/**
 * Tauri MCP Service - Desktop implementation
 * 
 * MOVED FROM: src/services/mcp.ts
 * NO IMPLEMENTATION CHANGES - EXACT SAME LOGIC MOVED HERE
 */

import { MCPTool } from '@/types/completion'
import { DefaultMCPService } from './default'

export class TauriMCPService extends DefaultMCPService {
  /**
   * MOVED FROM: updateMCPConfig function in src/services/mcp.ts
   */
  async updateMCPConfig(configs: string): Promise<void> {
    try {
      await window.core?.api?.saveMcpConfigs({ configs })
    } catch (error) {
      console.error('Error updating MCP config in Tauri, falling back to default:', error)
      return super.updateMCPConfig(configs)
    }
  }

  /**
   * MOVED FROM: restartMCPServers function in src/services/mcp.ts
   */
  async restartMCPServers(): Promise<void> {
    try {
      await window.core?.api?.restartMcpServers()
    } catch (error) {
      console.error('Error restarting MCP servers in Tauri, falling back to default:', error)
      return super.restartMCPServers()
    }
  }

  /**
   * MOVED FROM: getMCPConfig function in src/services/mcp.ts
   */
  async getMCPConfig(): Promise<object> {
    try {
      const configString = (await window.core?.api?.getMcpConfigs()) ?? '{}'
      const mcpConfig = JSON.parse(configString || '{}')
      return mcpConfig
    } catch (error) {
      console.error('Error getting MCP config in Tauri, falling back to default:', error)
      return super.getMCPConfig()
    }
  }

  /**
   * MOVED FROM: getTools function in src/services/mcp.ts
   */
  async getTools(): Promise<MCPTool[]> {
    try {
      return await window.core?.api?.getTools()
    } catch (error) {
      console.error('Error getting tools in Tauri, falling back to default:', error)
      return super.getTools()
    }
  }

  /**
   * MOVED FROM: getConnectedServers function in src/services/mcp.ts
   */
  async getConnectedServers(): Promise<string[]> {
    try {
      return await window.core?.api?.getConnectedServers()
    } catch (error) {
      console.error('Error getting connected servers in Tauri, falling back to default:', error)
      return super.getConnectedServers()
    }
  }

  /**
   * MOVED FROM: callTool function in src/services/mcp.ts
   */
  async callTool(args: {
    toolName: string
    arguments: object
  }): Promise<{ error: string; content: { text: string }[] }> {
    try {
      return await window.core?.api?.callTool(args)
    } catch (error) {
      console.error('Error calling tool in Tauri, falling back to default:', error)
      return super.callTool(args)
    }
  }

  /**
   * MOVED FROM: callToolWithCancellation function in src/services/mcp.ts
   */
  callToolWithCancellation(args: {
    toolName: string
    arguments: object
    cancellationToken?: string
  }): {
    promise: Promise<{ error: string; content: { text: string }[] }>
    cancel: () => Promise<void>
    token: string
  } {
    try {
      // Generate a unique cancellation token if not provided
      const token = args.cancellationToken ?? `tool_call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Create the tool call promise with cancellation token
      const promise = window.core?.api?.callTool({
        ...args,
        cancellationToken: token
      })
      
      // Create cancel function
      const cancel = async () => {
        await window.core?.api?.cancelToolCall({ cancellationToken: token })
      }
      
      return { promise, cancel, token }
    } catch (error) {
      console.error('Error calling tool with cancellation in Tauri, falling back to default:', error)
      return super.callToolWithCancellation(args)
    }
  }

  /**
   * MOVED FROM: cancelToolCall function in src/services/mcp.ts
   */
  async cancelToolCall(cancellationToken: string): Promise<void> {
    try {
      return await window.core?.api?.cancelToolCall({ cancellationToken })
    } catch (error) {
      console.error('Error canceling tool call in Tauri, falling back to default:', error)
      return super.cancelToolCall(cancellationToken)
    }
  }
}