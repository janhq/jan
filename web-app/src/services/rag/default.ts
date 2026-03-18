import type { RAGService } from './types'
import type { MCPTool, MCPToolCallResult, RAGExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum } from '@janhq/core'

export class DefaultRAGService implements RAGService {
  async getTools(): Promise<MCPTool[]> {
    const ext = ExtensionManager.getInstance().get<RAGExtension>(
      ExtensionTypeEnum.RAG
    )
    if (ext?.getTools) {
      try {
        return await ext.getTools()
      } catch (e) {
        console.error('RAG extension getTools failed:', e)
      }
    }
    return []
  }

  async callTool(args: {
    toolName: string
    arguments: Record<string, unknown>
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    const ext = ExtensionManager.getInstance().get<RAGExtension>(
      ExtensionTypeEnum.RAG
    )
    if (!ext?.callTool) {
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
      return await ext.callTool(args.toolName, a)
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      return {
        error: msg,
        content: [{ type: 'text', text: `RAG tool failed: ${msg}` }],
      }
    }
  }

  async getToolNames(): Promise<string[]> {
    try {
      const ext = ExtensionManager.getInstance().get<RAGExtension>(
        ExtensionTypeEnum.RAG
      )
      if (ext?.getToolNames) return await ext.getToolNames()
      // No fallback to full tool list; return empty to save bandwidth
      return []
    } catch (e) {
      console.error('Failed to fetch RAG tool names:', e)
      return []
    }
  }

  async parseDocument(path: string, type?: string): Promise<string> {
    try {
      const ext = ExtensionManager.getInstance().get<RAGExtension>(
        ExtensionTypeEnum.RAG
      )
      const parsed = await ext?.parseDocument?.(path, type)
      return parsed ?? ''
    } catch (e) {
      console.debug('RAG parseDocument unavailable', e)
    }

    return ''
  }
}
