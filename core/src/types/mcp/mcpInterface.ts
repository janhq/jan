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
   * @param toolName - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @param serverName - Optional server name to disambiguate tools with same name
   */
  callTool(toolName: string, args: Record<string, unknown>, serverName?: string): Promise<MCPToolCallResult>

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
