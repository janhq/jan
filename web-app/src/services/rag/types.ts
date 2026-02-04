import { MCPTool } from '@janhq/core'
import type { MCPToolCallResult } from '@janhq/core'

export interface RAGService {
  // Return tools exposed by RAG-related extensions (e.g., retrieval, list_attachments)
  getTools(): Promise<MCPTool[]>
  // Execute a RAG tool call (retrieve, list_attachments)
<<<<<<< HEAD
  callTool(args: { toolName: string; arguments: object; threadId?: string }): Promise<MCPToolCallResult>
=======
  callTool(args: {
    toolName: string
    arguments: object
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  // Convenience: return tool names for routing
  getToolNames(): Promise<string[]>
  // Parse a document to text for inline injection decisions
  parseDocument?: (path: string, type?: string) => Promise<string>
}
