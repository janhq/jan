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

export interface MCPPromptArgument {
  name: string
  description: string | null
  required: boolean | null
}

export interface MCPPrompt {
  name: string
  description: string | null
  server: string
  arguments: MCPPromptArgument[] | null
}

export interface MCPServerInfo {
  name: string
  connected: boolean
  tools?: MCPTool[]
}

