import { MCPTool } from '@janhq/core'
import type { MCPToolCallResult } from '@janhq/core'

export interface RAGService {
  // Return tools exposed by RAG-related extensions (e.g., retrieval, list_attachments)
  getTools(): Promise<MCPTool[]>
  // Execute a RAG tool call (retrieve, list_attachments)
  callTool(args: { toolName: string; arguments: object; threadId?: string }): Promise<MCPToolCallResult>
  // Convenience: return tool names for routing
  getToolNames(): Promise<string[]>
}
