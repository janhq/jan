import type { RAGService } from './types'
import { ServiceKeys, type MCPTool, type MCPToolCallResult } from '@janhq/core'
import { getExtensionHost } from '@/lib/extensions/host'

// The rag built-in registers its tools on the host's internal tool registry
// and publishes ingestion, parsing and embedding as ServiceKeys.RAG.
const ragService = () => getExtensionHost().services.get(ServiceKeys.RAG)
const internalTools = () => getExtensionHost().internalTools

export class DefaultRAGService implements RAGService {
  async getTools(): Promise<MCPTool[]> {
    return internalTools().definitions()
  }

  async callTool(args: {
    toolName: string
    arguments: Record<string, unknown>
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    const tools = internalTools()
    if (!tools.has(args.toolName)) {
      return {
        error: 'RAG extension not available',
        content: [{ type: 'text', text: 'RAG extension not available' }],
      }
    }
    try {
      // Inject context when scope requires it
      type ToolCallArgs = Record<string, unknown> & {
        scope?: string
        thread_id?: string
        project_id?: string
      }
      const a: ToolCallArgs = { ...(args.arguments as Record<string, unknown>) }
      if (args.scope === 'thread' && !a.thread_id) {
        a.thread_id = args.threadId
      }
      if (args.scope === 'project' && !a.project_id) {
        a.project_id = args.projectId
        a.thread_id = args.projectId
      }
      a.scope = args.scope
      return await tools.call(args.toolName, a)
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      return {
        error: msg,
        content: [{ type: 'text', text: `RAG tool failed: ${msg}` }],
      }
    }
  }

  async getToolNames(): Promise<string[]> {
    return internalTools().names()
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return []
    try {
      const rag = ragService()
      if (rag) return await rag.embed(texts)
    } catch (e) {
      console.debug('RAG embed unavailable', e)
    }
    return []
  }

  async parseDocument(path: string, type?: string): Promise<string> {
    try {
      const parsed = await ragService()?.parseDocument(path, type)
      return parsed ?? ''
    } catch (e) {
      console.debug('RAG parseDocument unavailable', e)
    }

    return ''
  }
}
