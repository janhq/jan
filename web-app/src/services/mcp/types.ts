/**
 * MCP Service Types
 */

import { MCPTool } from '@/types/completion'
import type { MCPServerConfig, MCPServers } from '@/hooks/useMCPServers'

export interface MCPConfig {
  mcpServers?: MCPServers
}

export interface ToolCallResult {
  error: string
  content: { text: string }[]
}

export interface ToolCallWithCancellationResult {
  promise: Promise<ToolCallResult>
  cancel: () => Promise<void>
  token: string
}

export interface MCPService {
  updateMCPConfig(configs: string): Promise<void>
  restartMCPServers(): Promise<void>
  getMCPConfig(): Promise<MCPConfig>
  getTools(): Promise<MCPTool[]>
  getConnectedServers(): Promise<string[]>
  callTool(args: { toolName: string; arguments: object }): Promise<ToolCallResult>
  callToolWithCancellation(args: {
    toolName: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult
  cancelToolCall(cancellationToken: string): Promise<void>
  
  // MCP Server lifecycle management
  activateMCPServer(name: string, config: MCPServerConfig): Promise<void>
  deactivateMCPServer(name: string): Promise<void>
}