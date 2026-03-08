/**
 * MCP Tool schema
 * This schema defines the structure of an MCP tool.
 */
export type MCPTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  server: string
}
