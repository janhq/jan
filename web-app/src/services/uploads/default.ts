import type { UploadsService, UploadResult } from './types'
import type { Attachment } from '@/types/attachment'
import { ulid } from 'ulidx'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, type RAGExtension, type IngestAttachmentsResult } from '@janhq/core'

export class DefaultUploadsService implements UploadsService {
  async ingestImage(_threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'image') throw new Error('ingestImage: attachment is not image')
    // Placeholder upload flow; swap for real API call when backend is ready
    await new Promise((r) => setTimeout(r, 100))
    return { id: ulid() }
  }

  async ingestFileAttachment(threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document') throw new Error('ingestFileAttachment: attachment is not document')
    const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
    if (!ext?.ingestAttachments) throw new Error('RAG extension not available')
    const res: IngestAttachmentsResult = await ext.ingestAttachments(threadId, [
      { path: attachment.path!, name: attachment.name, type: attachment.fileType, size: attachment.size },
    ])
    const files = res.files
    if (Array.isArray(files) && files[0]?.id) {
      return {
        id: files[0].id,
        size: typeof files[0].size === 'number' ? Number(files[0].size) : undefined,
        chunkCount: typeof files[0].chunk_count === 'number' ? Number(files[0].chunk_count) : undefined,
      }
    }
    throw new Error('Failed to resolve ingested attachment id')
  }

  async ingestFileAttachmentForProject(projectId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document') throw new Error('ingestFileAttachmentForProject: attachment is not document')
    const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
    if (!ext?.ingestAttachmentsForProject) throw new Error('RAG extension does not support project-level ingestion')
    const res: IngestAttachmentsResult = await ext.ingestAttachmentsForProject(projectId, [
      { path: attachment.path!, name: attachment.name, type: attachment.fileType, size: attachment.size },
    ])
    const files = res.files
    if (Array.isArray(files) && files[0]?.id) {
      return {
        id: files[0].id,
        size: typeof files[0].size === 'number' ? Number(files[0].size) : undefined,
        chunkCount: typeof files[0].chunk_count === 'number' ? Number(files[0].chunk_count) : undefined,
      }
    }
    throw new Error('Failed to resolve ingested attachment id')
  }
}
