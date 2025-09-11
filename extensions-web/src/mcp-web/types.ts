/**
 * MCP Web Extension Types
 */

export interface MCPApiResponse {
  content?: Array<{
    type?: string
    text?: string
  }>
  result?: string | object
}

