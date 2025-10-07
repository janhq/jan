import type { RAGService } from './types'
import type { MCPTool } from '@janhq/core'

export class DefaultRAGService implements RAGService {
  async getTools(): Promise<MCPTool[]> {
    // Temporarily return no tools; real tools will be provided by rag-extension later
    return []
  }
}
