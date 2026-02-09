import type { Attachment } from '@/types/attachment'

export type UploadResult = {
  id: string
  url?: string
  size?: number
  chunkCount?: number
}

export interface UploadsService {
  // Ingest an image attachment (placeholder upload)
  ingestImage(threadId: string, attachment: Attachment): Promise<UploadResult>

  // Ingest a document attachment in the context of a thread
  ingestFileAttachment(threadId: string, attachment: Attachment): Promise<UploadResult>

  // Ingest a document attachment in the context of a project (shared across all threads)
  ingestFileAttachmentForProject(projectId: string, attachment: Attachment): Promise<UploadResult>
}
