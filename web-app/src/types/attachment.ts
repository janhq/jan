/**
 * Unified attachment type for images, documents, and audio
 */
export type Attachment = {
  name: string
  type: 'image' | 'document' | 'audio' | 'video'

  /** For audio attachments: 'wav' or 'mp3' per llama.cpp mtmd support. */
  audioFormat?: 'wav' | 'mp3'
  /** Audio/video duration in seconds (decoded client-side for the chip preview). */
  durationSec?: number

  // Common fields
  size?: number
  chunkCount?: number
  processing?: boolean
  processed?: boolean
  error?: string

  // For images (before upload)
  base64?: string
  dataUrl?: string
  mimeType?: string
  contentHash?: string // Used for deduplication (different files can have same name)

  // For documents (local files)
  path?: string
  fileType?: string // e.g., 'pdf', 'docx'
  parseMode?: 'auto' | 'inline' | 'embeddings' | 'prompt'

  // After processing (images uploaded, documents ingested)
  id?: string
  injectionMode?: 'inline' | 'embeddings'
  inlineContent?: string
}

/**
 * Helper to create image attachment
 */
export function createImageAttachment(data: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  size: number
}): Attachment {
  return {
    ...data,
    type: 'image',
  }
}

/**
 * Helper to create audio attachment
 */
export function createAudioAttachment(data: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  audioFormat: 'wav' | 'mp3'
  size: number
  durationSec?: number
}): Attachment {
  return {
    ...data,
    type: 'audio',
  }
}

/**
 * Helper to create video attachment
 */
export function createVideoAttachment(data: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  size: number
  durationSec?: number
}): Attachment {
  return {
    ...data,
    type: 'video',
  }
}

/**
 * Helper to create document attachment
 */
export function createDocumentAttachment(data: {
  name: string
  path: string
  fileType?: string
  size?: number
  parseMode?: 'auto' | 'inline' | 'embeddings' | 'prompt'
}): Attachment {
  return {
    ...data,
    type: 'document',
  }
}
