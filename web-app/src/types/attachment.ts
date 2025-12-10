/**
 * Unified attachment type for both images and documents
 */
export type Attachment = {
  name: string
  type: 'image' | 'document'

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
