interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  server: string
}

interface MCPToolCallResult {
  error: string
  content: Array<{
    type?: string
    text: string
  }>
}

interface GetToolsResponse {
  object: string
  data: MCPTool[]
}

interface CallToolPayload {
  toolName: string
  serverName?: string
  arguments: Record<string, unknown>
}
