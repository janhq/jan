/**
 * Enhanced Attachment Types with Media Server Integration
 * Updated types that support both legacy base64 and new jan_id system
 */

// Base attachment interface
export interface BaseAttachment {
  name: string
  size?: number
  chunkCount?: number
  processing?: boolean
  processed?: boolean
  error?: string
  id?: string // Generic ID for processed attachments
}

// Enhanced image attachment with media server support
export interface ImageAttachment extends BaseAttachment {
  type: 'image'
  
  // File metadata
  mimeType: string
  
  // Client-side preview (for immediate display)
  dataUrl?: string
  base64?: string // Legacy support
  
  // Server upload state
  uploading?: boolean
  uploaded?: boolean
  uploadError?: string
  
  // Server-side media reference
  janId?: string // jan_abc123 from media server
  serverBytes?: number // Server-reported size
  deduped?: boolean // Whether server deduplicated this upload
  presignedUrl?: string // Optional direct access URL
  
  // Upload metadata
  uploadedAt?: Date
  userId?: string // User context for upload
}

// Document attachment (unchanged for now)
export interface DocumentAttachment extends BaseAttachment {
  type: 'document'
  path?: string
  fileType?: string
}

// Union type for all attachments
export type Attachment = ImageAttachment | DocumentAttachment

// Type guards
export function isImageAttachment(attachment: Attachment): attachment is ImageAttachment {
  return attachment.type === 'image'
}

export function isDocumentAttachment(attachment: Attachment): attachment is DocumentAttachment {
  return attachment.type === 'document'
}

// Helper functions for creating attachments
export function createImageAttachment(data: {
  name: string
  dataUrl: string
  mimeType: string
  size: number
}): ImageAttachment {
  return {
    ...data,
    type: 'image',
    base64: data.dataUrl.split(',')[1], // Extract base64 for legacy support
  }
}

export function createDocumentAttachment(data: {
  name: string
  path: string
  fileType?: string
  size?: number
}): DocumentAttachment {
  return {
    ...data,
    type: 'document',
  }
}

// Enhanced helper for creating image attachment with server data
export function createImageAttachmentWithServer(data: {
  name: string
  dataUrl: string
  mimeType: string
  size: number
  janId?: string
  serverBytes?: number
  deduped?: boolean
  presignedUrl?: string
  uploaded?: boolean
}): ImageAttachment {
  return {
    ...createImageAttachment(data),
    janId: data.janId,
    serverBytes: data.serverBytes,
    deduped: data.deduped,
    presignedUrl: data.presignedUrl,
    uploaded: data.uploaded || !!data.janId,
    uploadedAt: data.janId ? new Date() : undefined,
  }
}

// Utility functions for attachment states
export function isAttachmentUploading(attachment: Attachment): boolean {
  return isImageAttachment(attachment) && !!attachment.uploading
}

export function isAttachmentUploaded(attachment: Attachment): boolean {
  return isImageAttachment(attachment) && !!attachment.uploaded
}

export function hasAttachmentError(attachment: Attachment): boolean {
  return !!attachment.error || (isImageAttachment(attachment) && !!attachment.uploadError)
}

export function getAttachmentDisplayUrl(attachment: ImageAttachment): string | undefined {
  // Prefer presigned URL, fall back to data URL
  return attachment.presignedUrl || attachment.dataUrl
}

export function getAttachmentId(attachment: Attachment): string | undefined {
  if (isImageAttachment(attachment)) {
    return attachment.janId || attachment.id
  }
  return attachment.id
}

// Migration utilities for legacy attachments
export function migrateImageAttachment(legacy: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  size: number
}): ImageAttachment {
  return createImageAttachment({
    name: legacy.name,
    dataUrl: legacy.dataUrl,
    mimeType: legacy.mimeType,
    size: legacy.size,
  })
}

// Attachment collection utilities
export function getImageAttachments(attachments: Attachment[]): ImageAttachment[] {
  return attachments.filter(isImageAttachment)
}

export function getDocumentAttachments(attachments: Attachment[]): DocumentAttachment[] {
  return attachments.filter(isDocumentAttachment)
}

export function getUploadingAttachments(attachments: Attachment[]): ImageAttachment[] {
  return getImageAttachments(attachments).filter(att => att.uploading)
}

export function getUploadedAttachments(attachments: Attachment[]): ImageAttachment[] {
  return getImageAttachments(attachments).filter(att => att.uploaded)
}

export function getFailedAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.filter(hasAttachmentError)
}

// Validation utilities
export function validateImageAttachment(attachment: ImageAttachment): string[] {
  const errors: string[] = []
  
  if (!attachment.name) {
    errors.push('Image name is required')
  }
  
  if (!attachment.mimeType) {
    errors.push('MIME type is required')
  }
  
  if (!attachment.dataUrl && !attachment.janId) {
    errors.push('Either data URL or jan_id is required')
  }
  
  if (attachment.size && attachment.size > 10 * 1024 * 1024) {
    errors.push('Image size exceeds 10MB limit')
  }
  
  return errors
}

// Types are fully defined in this file
export type LegacyAttachment = Attachment