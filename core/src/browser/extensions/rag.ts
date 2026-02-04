import { BaseExtension, ExtensionTypeEnum } from '../extension'
import type { MCPTool, MCPToolCallResult } from '../../types'
import type { AttachmentFileInfo } from './vector-db'

export interface AttachmentInput {
  path: string
  name?: string
  type?: string
  size?: number
}

export interface IngestAttachmentsResult {
  filesProcessed: number
  chunksInserted: number
  files: AttachmentFileInfo[]
}

export const RAG_INTERNAL_SERVER = 'rag-internal'

/**
 * RAG extension base: exposes RAG tools and orchestration API.
 */
export abstract class RAGExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.RAG
  }

  abstract getTools(): Promise<MCPTool[]>
  /**
   * Lightweight list of tool names for quick routing/lookup.
   */
  abstract getToolNames(): Promise<string[]>
  abstract callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult>

  abstract ingestAttachments(threadId: string, files: AttachmentInput[]): Promise<IngestAttachmentsResult>

  /**
<<<<<<< HEAD
=======
   * Ingest files for a project-level collection (shared across all threads in the project)
   */
  abstract ingestAttachmentsForProject(projectId: string, files: AttachmentInput[]): Promise<IngestAttachmentsResult>

  /**
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
   * Parse a document into plain text for inline ingestion or preprocessing.
   */
  abstract parseDocument(path: string, type?: string): Promise<string>
}
