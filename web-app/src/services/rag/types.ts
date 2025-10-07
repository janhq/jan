import { MCPTool } from '@janhq/core'

export interface RAGService {
  // Return tools exposed by RAG-related extensions (e.g., retrieval, list_attachments)
  getTools(): Promise<MCPTool[]>
}

