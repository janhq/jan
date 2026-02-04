import type { RAGService } from './types'
import type { MCPTool, MCPToolCallResult, RAGExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum } from '@janhq/core'

export class DefaultRAGService implements RAGService {
  async getTools(): Promise<MCPTool[]> {
<<<<<<< HEAD
    const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
=======
    const ext = ExtensionManager.getInstance().get<RAGExtension>(
      ExtensionTypeEnum.RAG
    )
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    if (ext?.getTools) {
      try {
        return await ext.getTools()
      } catch (e) {
        console.error('RAG extension getTools failed:', e)
      }
    }
    return []
  }

<<<<<<< HEAD
  async callTool(args: { toolName: string; arguments: Record<string, unknown>; threadId?: string }): Promise<MCPToolCallResult> {
    const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
    if (!ext?.callTool) {
      return { error: 'RAG extension not available', content: [{ type: 'text', text: 'RAG extension not available' }] }
    }
    try {
      // Inject thread context when scope requires it
      type ToolCallArgs = Record<string, unknown> & { scope?: string; thread_id?: string }
      const a: ToolCallArgs = { ...(args.arguments as Record<string, unknown>) }
      if (!a.scope) a.scope = 'thread'
      if (a.scope === 'thread' && !a.thread_id) {
        a.thread_id = args.threadId
      }
      return await ext.callTool(args.toolName, a)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg, content: [{ type: 'text', text: `RAG tool failed: ${msg}` }] }
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    }
  }

  async getToolNames(): Promise<string[]> {
    try {
<<<<<<< HEAD
      const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
=======
      const ext = ExtensionManager.getInstance().get<RAGExtension>(
        ExtensionTypeEnum.RAG
      )
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
      const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
=======
      const ext = ExtensionManager.getInstance().get<RAGExtension>(
        ExtensionTypeEnum.RAG
      )
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      const parsed = await ext?.parseDocument?.(path, type)
      return parsed ?? ''
    } catch (e) {
      console.debug('RAG parseDocument unavailable', e)
    }

    return ''
  }
}
