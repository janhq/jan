/**
 * Tauri MCP Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { MCPTool } from '@/types/completion'
import type { MCPServerConfig } from '@/hooks/useMCPServers'
import { DefaultMCPService } from './default'

export class TauriMCPService extends DefaultMCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    try {
      await window.core?.api?.saveMcpConfigs({ configs })
    } catch (error) {
      console.error('Error updating MCP config in Tauri, falling back to default:', error)
      return super.updateMCPConfig(configs)
    }
  }

  async restartMCPServers(): Promise<void> {
    try {
      await window.core?.api?.restartMcpServers()
    } catch (error) {
      console.error('Error restarting MCP servers in Tauri, falling back to default:', error)
      return super.restartMCPServers()
    }
  }

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

  async getTools(): Promise<MCPTool[]> {
    try {
      return await window.core?.api?.getTools()
    } catch (error) {
      console.error('Error getting tools in Tauri, falling back to default:', error)
      return super.getTools()
    }
  }

  async getConnectedServers(): Promise<string[]> {
    try {
      return await window.core?.api?.getConnectedServers()
    } catch (error) {
      console.error('Error getting connected servers in Tauri, falling back to default:', error)
      return super.getConnectedServers()
    }
  }

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

  async cancelToolCall(cancellationToken: string): Promise<void> {
    try {
      return await window.core?.api?.cancelToolCall({ cancellationToken })
    } catch (error) {
      console.error('Error canceling tool call in Tauri, falling back to default:', error)
      return super.cancelToolCall(cancellationToken)
    }
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    try {
      return await invoke('activate_mcp_server', { name, config })
    } catch (error) {
      console.error('Error activating MCP server in Tauri, falling back to default:', error)
      return super.activateMCPServer(name, config)
    }
  }

  async deactivateMCPServer(name: string): Promise<void> {
    try {
      return await invoke('deactivate_mcp_server', { name })
    } catch (error) {
      console.error('Error deactivating MCP server in Tauri, falling back to default:', error)
      return super.deactivateMCPServer(name)
    }
  }
}