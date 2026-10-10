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

  // Save a file dropped onto the chat (which has no path on disk) into Jan's
  // data folder and return the saved file's path, so it can be attached like
  // a file picked with the dialog
  saveDroppedFile(file: File): Promise<string>

  // Copy a file on disk into Jan's data folder and return the copy's path, so
  // a file sent to the model as it is stays readable for later turns
  keepAttachmentFile(path: string, fileName: string): Promise<string>

  // Read a file on disk as a data URL, to send it to the model as it is
  readAttachmentAsDataUrl(path: string, mediaType: string): Promise<string>
}
