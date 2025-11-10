/**
 * MCP (Model Context Protocol) entities
 */

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  server: string
}

export interface MCPToolCallResult {
  error: string
  content: Array<{
    type?: string
    text: string
  }>
}

export interface MCPServerInfo {
  name: string
  connected: boolean
  tools?: MCPTool[]
}