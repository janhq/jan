/**
 * Browser tool definitions for MCP Browser Extension
 * Uses dynamic schemas from mcp-web-client
 */

import { getToolSchemas, type ToolSchema } from 'mcp-web-client'
import type { MCPTool } from '@janhq/core'

export const BROWSER_SERVER_NAME = 'Jan Browser Extension'

/**
 * Get browser tool names dynamically from schemas
 */
export function getBrowserToolNames(): string[] {
  return getToolSchemas().map((schema) => schema.name)
}

/**
 * Check if a tool name is a browser tool
 */
export function isBrowserTool(toolName: string): boolean {
  return getBrowserToolNames().includes(toolName)
}

/**
 * Get browser tools as MCPTool format
 * Converts ToolSchema to MCPTool with server name
 */
export function getBrowserTools(): MCPTool[] {
  return getToolSchemas().map((schema: ToolSchema) => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    server: BROWSER_SERVER_NAME,
  }))
}

// For backward compatibility - static list derived from schemas
export const BROWSER_TOOL_NAMES = getBrowserToolNames()
