/**
 * Enhanced Media Service Types
 * Types for integrating with Jan media server using jan_id references
 */

export interface MediaUploadResponse {
  /** Unique media identifier in jan_abc123 format */
  id: string
  /** MIME type of the uploaded media */
  mime: string
  /** Size in bytes as reported by server */
  bytes: number
  /** Whether this media was deduplicated (already existed) */
  deduped: boolean
  /** Optional presigned URL for direct access */
  presigned_url?: string
}

export interface MediaUploadRequest {
  source: {
    type: 'data_url' | 'remote_url'
    data_url?: string
    url?: string
  }
  filename: string
  user_id?: string
}

export interface MediaResolveRequest {
  payload: any
}

export interface MediaResolveResponse {
  payload: any
}

export interface MediaPresignedUrlResponse {
  /** Media ID (jan_abc123) */
  id: string
  /** Presigned URL for downloading the media */
  url: string
  /** Expiration time in seconds */
  expires_in: number
}

export interface MediaPrepareUploadRequest {
  /** MIME type of the file to be uploaded */
  mime_type: string
  /** User ID for context */
  user_id?: string
}

export interface MediaPrepareUploadResponse {
  /** Media ID (jan_abc123) pre-assigned for this upload */
  id: string
  /** Presigned URL for uploading directly to S3 */
  upload_url: string
  /** MIME type */
  mime_type: string
  /** Expiration time in seconds */
  expires_in: number
}

export interface MediaService {
  /**
   * Upload image from data URL
   * @param dataUrl Base64 data URL (data:image/jpeg;base64,...)
   * @param filename Original filename
   * @param userId Optional user context
   * @returns Server response with jan_id
   */
  uploadImage(dataUrl: string, filename: string, userId?: string): Promise<MediaUploadResponse>
  
  /**
   * Upload image from File object
   * @param file File object from input or drag/drop
   * @param userId Optional user context
   * @returns Server response with jan_id
   */
  uploadImageFile(file: File, userId?: string): Promise<MediaUploadResponse>
  
  /**
   * Get media information by jan_id
   * @param janId Media ID (jan_abc123)
   * @returns Media metadata
   */
  getMediaInfo(janId: string): Promise<MediaUploadResponse>
  
  /**
   * Resolve jan_id placeholders in message payload
   * Converts data:image/jpeg;jan_abc123 to actual URLs
   * @param payload Message payload with placeholders
   * @returns Payload with resolved URLs
   */
  resolveMediaPlaceholders(payload: any): Promise<any>
  
  /**
   * Get direct download/stream URL for media
   * @param janId Media ID
   * @returns Direct access URL or stream
   */
  getMediaUrl(janId: string): Promise<string>
  
  /**
   * Get a presigned URL for downloading media
   * This is the dedicated endpoint for obtaining download URLs
   * @param janId Media ID (jan_abc123)
   * @returns Presigned URL response with expiration
   */
  getPresignedUrl(janId: string): Promise<MediaPresignedUrlResponse>
  
  /**
   * Prepare for direct S3 upload
   * Gets a presigned upload URL and pre-assigned jan_id
   * @param mimeType MIME type of the file to upload
   * @param userId Optional user context
   * @returns Upload URL and media ID
   */
  prepareUpload(mimeType: string, userId?: string): Promise<MediaPrepareUploadResponse>
}

export interface MediaConfig {
  baseUrl: string
  serviceKey: string
  maxFileSize: number
  supportedFormats: string[]
  enableDeduplication: boolean
  enablePresignedUrls: boolean
}

export type MediaUploadSource = 
  | { type: 'data_url'; data_url: string }
  | { type: 'remote_url'; url: string }

export interface MediaUploadOptions {
  filename: string
  userId?: string
  source: MediaUploadSource
}

// Error types
export class MediaUploadError extends Error {
  constructor(message: string, public status?: number, public response?: any) {
    super(message)
    this.name = 'MediaUploadError'
  }
}

export class MediaResolutionError extends Error {
  constructor(message: string, public janId?: string) {
    super(message)
    this.name = 'MediaResolutionError'
  }
}