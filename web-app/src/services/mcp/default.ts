/**
 * Default MCP Service - Generic implementation with minimal returns
 */

import { MCPTool, MCPToolCallResult } from '@janhq/core'
import type { MCPServerConfig } from '@/hooks/useMCPServers'
import type { MCPService, MCPConfig, ToolCallWithCancellationResult } from './types'

export class DefaultMCPService implements MCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    console.log('updateMCPConfig called with configs:', configs)
    // No-op - not implemented in default service
  }

  async restartMCPServers(): Promise<void> {
    // No-op
  }

  async getMCPConfig(): Promise<MCPConfig> {
    return {}
  }

  async getTools(): Promise<MCPTool[]> {
    return []
  }

  async getConnectedServers(): Promise<string[]> {
    return []
  }

  async callTool(args: { toolName: string; arguments: object }): Promise<MCPToolCallResult> {
    console.log('callTool called with args:', args)
    return {
      error: '',
      content: []
    }
  }

  callToolWithCancellation(args: {
    toolName: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult {
    console.log('callToolWithCancellation called with args:', args)
    return {
      promise: Promise.resolve({
        error: '',
        content: []
      }),
      cancel: () => Promise.resolve(),
      token: ''
    }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    console.log('cancelToolCall called with token:', cancellationToken)
    // No-op - not implemented in default service
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    console.log('activateMCPServer called:', { name, config })
    // No-op - not implemented in default service
  }

  async deactivateMCPServer(name: string): Promise<void> {
    console.log('deactivateMCPServer called with name:', name)
    // No-op - not implemented in default service
  }

  async checkJanBrowserExtensionConnected(): Promise<boolean> {
    return false
  }
}
