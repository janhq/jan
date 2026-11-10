/**
 * MCP Tool schema
 * This schema defines the structure of an MCP tool.
 */
export type MCPTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  server: string
  /** The connection the tool was listed from. A call passes it back so a
   * server restarted since cannot run it. */
  generation?: number
}
