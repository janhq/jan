/**
 * MCP (Model Context Protocol) interface
 */

import { MCPTool, MCPToolCallResult } from './mcpEntity'

export interface MCPInterface {
  /**
   * Get all available MCP tools
   */
  getTools(): Promise<MCPTool[]>

  /**
   * Call a specific MCP tool
   */
  callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult>

  /**
   * Get list of connected MCP servers
   */
  getConnectedServers(): Promise<string[]>

  /**
   * Refresh the list of available tools
   */
  refreshTools(): Promise<void>

  /**
   * Check if MCP service is healthy
   */
  isHealthy(): Promise<boolean>
}