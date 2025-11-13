/**
 * Jan Media Service Implementation
 * Handles media upload, resolution, and retrieval via Jan media server
 */

import { getSharedAuthService } from '../auth'
import type { 
  MediaService, 
  MediaUploadResponse, 
  MediaUploadRequest,
  MediaResolveRequest,
  MediaResolveResponse,
  MediaConfig
} from './types'
import { MediaUploadError, MediaResolutionError } from './types'

declare const JAN_BASE_URL: string

export class JanMediaService implements MediaService {
  private readonly config: MediaConfig

  constructor(config?: Partial<MediaConfig>) {
    this.config = {
      baseUrl: `${JAN_BASE_URL}/media`,
      serviceKey: 'changeme-media-key', // Should come from env/config
      maxFileSize: 10 * 1024 * 1024, // 10MB
      supportedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      enableDeduplication: true,
      enablePresignedUrls: true,
      ...config
    }
  }

  async uploadImage(dataUrl: string, filename: string, userId?: string): Promise<MediaUploadResponse> {
    this.validateDataUrl(dataUrl)
    
    const authService = getSharedAuthService()
    const token = await authService.getValidAccessToken()
    
    const request: MediaUploadRequest = {
      source: {
        type: 'data_url',
        data_url: dataUrl,
      },
      filename,
      user_id: userId || 'anonymous',
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/media`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Media-Service-Key': this.config.serviceKey,
        },
        body: JSON.stringify(request)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new MediaUploadError(
          `Upload failed: ${response.status} ${response.statusText}`,
          response.status,
          errorData
        )
      }

      const result = await response.json() as MediaUploadResponse
      
      // Validate response format
      if (!result.id || !result.id.startsWith('jan_')) {
        throw new MediaUploadError('Invalid response: missing or invalid media ID')
      }

      return result
    } catch (error) {
      if (error instanceof MediaUploadError) {
        throw error
      }
      throw new MediaUploadError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async uploadImageFile(file: File, userId?: string): Promise<MediaUploadResponse> {
    this.validateFile(file)
    
    const dataUrl = await this.fileToDataUrl(file)
    return this.uploadImage(dataUrl, file.name, userId)
  }

  async getMediaInfo(janId: string): Promise<MediaUploadResponse> {
    this.validateJanId(janId)
    
    const authService = getSharedAuthService()
    const token = await authService.getValidAccessToken()

    const response = await fetch(`${this.config.baseUrl}/v1/media/${janId}`, {
      method: 'HEAD', // Get metadata without downloading content
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Media-Service-Key': this.config.serviceKey,
      }
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new MediaResolutionError(`Media not found: ${janId}`, janId)
      }
      throw new MediaResolutionError(`Failed to get media info: ${response.status}`)
    }

    // Extract info from headers (if available) or make a separate API call
    // For now, return minimal info - could be enhanced with dedicated metadata endpoint
    return {
      id: janId,
      mime: response.headers.get('Content-Type') || 'image/jpeg',
      bytes: parseInt(response.headers.get('Content-Length') || '0'),
      deduped: false, // Not available from HEAD request
    }
  }

  async resolveMediaPlaceholders(payload: any): Promise<any> {
    const authService = getSharedAuthService()
    const token = await authService.getValidAccessToken()

    const request: MediaResolveRequest = { payload }

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/media/resolve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Media-Service-Key': this.config.serviceKey,
        },
        body: JSON.stringify(request)
      })

      if (!response.ok) {
        throw new MediaResolutionError(`Resolution failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json() as MediaResolveResponse
      return result.payload
    } catch (error) {
      if (error instanceof MediaResolutionError) {
        throw error
      }
      throw new MediaResolutionError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async getMediaUrl(janId: string): Promise<string> {
    this.validateJanId(janId)
    
    const authService = getSharedAuthService()
    const token = await authService.getValidAccessToken()

    const response = await fetch(`${this.config.baseUrl}/v1/media/${janId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Media-Service-Key': this.config.serviceKey,
      }
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new MediaResolutionError(`Media not found: ${janId}`, janId)
      }
      throw new MediaResolutionError(`Failed to get media URL: ${response.status}`)
    }

    const contentType = response.headers.get('Content-Type')
    
    if (contentType?.includes('application/json')) {
      // Server returns presigned URL
      const result = await response.json()
      if (result.url) {
        return result.url
      }
      throw new MediaResolutionError('No URL in response')
    } else {
      // Server streams content directly - create blob URL
      const blob = await response.blob()
      return URL.createObjectURL(blob)
    }
  }

  async getPresignedUrl(janId: string): Promise<import('./types').MediaPresignedUrlResponse> {
    this.validateJanId(janId)
    
    const authService = getSharedAuthService()
    const token = await authService.getValidAccessToken()

    const response = await fetch(`${this.config.baseUrl}/v1/media/${janId}/presign`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Media-Service-Key': this.config.serviceKey,
      }
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new MediaResolutionError(`Media not found: ${janId}`, janId)
      }
      throw new MediaResolutionError(`Failed to get presigned URL: ${response.status}`)
    }

    const result = await response.json()
    
    if (!result.id || !result.url || !result.expires_in) {
      throw new MediaResolutionError('Invalid presigned URL response format')
    }

    return result
  }

  async prepareUpload(mimeType: string, userId?: string): Promise<import('./types').MediaPrepareUploadResponse> {
    const authService = getSharedAuthService()
    const token = await authService.getValidAccessToken()

    const requestBody: import('./types').MediaPrepareUploadRequest = {
      mime_type: mimeType,
      user_id: userId || 'anonymous',
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/media/prepare-upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Media-Service-Key': this.config.serviceKey,
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new MediaUploadError(
          `Prepare upload failed: ${response.status} ${response.statusText}`,
          response.status,
          errorData
        )
      }

      const result = await response.json()
      
      if (!result.id || !result.upload_url || !result.expires_in) {
        throw new MediaUploadError('Invalid prepare upload response format')
      }

      return result
    } catch (error) {
      if (error instanceof MediaUploadError) {
        throw error
      }
      throw new MediaUploadError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Helper methods
  private validateDataUrl(dataUrl: string): void {
    if (!dataUrl.startsWith('data:')) {
      throw new MediaUploadError('Invalid data URL format')
    }
    
    const [header] = dataUrl.split(',')
    const mimeMatch = header.match(/data:([^;]+)/)
    if (!mimeMatch) {
      throw new MediaUploadError('Cannot extract MIME type from data URL')
    }
    
    const mimeType = mimeMatch[1]
    if (!this.config.supportedFormats.includes(mimeType)) {
      throw new MediaUploadError(`Unsupported format: ${mimeType}`)
    }
  }

  private validateFile(file: File): void {
    if (file.size > this.config.maxFileSize) {
      throw new MediaUploadError(
        `File too large: ${file.size} bytes (max: ${this.config.maxFileSize})`
      )
    }
    
    if (file.type && !this.config.supportedFormats.includes(file.type)) {
      throw new MediaUploadError(`Unsupported file type: ${file.type}`)
    }
  }

  private validateJanId(janId: string): void {
    if (!janId.match(/^jan_[a-z0-9]+$/)) {
      throw new MediaResolutionError(`Invalid jan_id format: ${janId}`)
    }
  }

  private async fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') {
          resolve(result)
        } else {
          reject(new Error('Failed to convert file to data URL'))
        }
      }
      reader.onerror = () => reject(new Error('FileReader error'))
      reader.readAsDataURL(file)
    })
  }

  // Utility methods for jan_id extraction and resolution

  /**
   * Extract jan_id from data URL placeholder format
   * Supports formats: 
   * - data:image/jpeg;jan_abc123
   * - data:image/png;base64,jan_abc123
   */
  extractJanId(dataUrl: string): string | null {
    if (!dataUrl || typeof dataUrl !== 'string') {
      return null
    }

    // Match pattern: data:image/[type];jan_[id]
    // or data:image/[type];base64,jan_[id]
    const janIdPattern = /data:image\/[^;]+;(?:base64,)?(jan_[a-z0-9]+)/
    const match = dataUrl.match(janIdPattern)
    
    return match ? match[1] : null
  }

  /**
   * Check if a string contains a jan_id placeholder
   */
  hasJanIdPlaceholder(src: string): boolean {
    return src.includes('jan_') && src.startsWith('data:image/')
  }

  /**
   * Resolve image src with jan_id placeholder to presigned URL
   * Transforms: data:image/jpeg;jan_abc123 → https://s3.amazonaws.com/...
   * 
   * @param imageSrc Image src attribute value
   * @returns Presigned URL or original src if no jan_id found
   */
  async resolveImageSrc(imageSrc: string): Promise<string> {
    const janId = this.extractJanId(imageSrc)
    
    if (!janId) {
      // No jan_id found, return original src
      return imageSrc
    }

    try {
      const presigned = await this.getPresignedUrl(janId)
      return presigned.url
    } catch (error) {
      console.error(`Failed to resolve jan_id ${janId}:`, error)
      // Return original src as fallback
      return imageSrc
    }
  }

  /**
   * Resolve multiple image sources with jan_id placeholders
   * Useful for batch processing multiple images
   * 
   * @param imageSrcs Array of image src values
   * @returns Array of resolved URLs
   */
  async resolveImageSrcs(imageSrcs: string[]): Promise<string[]> {
    return Promise.all(
      imageSrcs.map(src => this.resolveImageSrc(src))
    )
  }

  /**
   * Process HTML content and resolve all jan_id placeholders in img tags
   * 
   * @param html HTML content with img tags
   * @returns HTML with resolved presigned URLs
   */
  async resolveHtmlImages(html: string): Promise<string> {
    // Find all img src attributes with jan_id placeholders
    const imgPattern = /<img[^>]+src=["']([^"']*jan_[a-z0-9]+[^"']*)["'][^>]*>/gi
    const matches = Array.from(html.matchAll(imgPattern))
    
    if (matches.length === 0) {
      return html
    }

    let resolvedHtml = html
    
    // Resolve each image src
    for (const match of matches) {
      const fullImgTag = match[0]
      const originalSrc = match[1]
      const janId = this.extractJanId(originalSrc)
      
      if (janId) {
        try {
          const presigned = await this.getPresignedUrl(janId)
          const updatedImgTag = fullImgTag.replace(originalSrc, presigned.url)
          resolvedHtml = resolvedHtml.replace(fullImgTag, updatedImgTag)
        } catch (error) {
          console.error(`Failed to resolve jan_id ${janId} in HTML:`, error)
          // Keep original src on error
        }
      }
    }
    
    return resolvedHtml
  }

  /**
   * Create a cache for presigned URLs to avoid repeated API calls
   * URLs are cached with their expiration time
   */
  private urlCache = new Map<string, { url: string; expiresAt: number }>()

  /**
   * Get presigned URL with caching support
   * Reuses cached URLs if they haven't expired
   * 
   * @param janId Media ID
   * @param forceRefresh Force fetch new URL even if cached
   * @returns Presigned URL
   */
  async getPresignedUrlCached(janId: string, forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.urlCache.get(janId)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.url
      }
    }

    const presigned = await this.getPresignedUrl(janId)
    
    // Cache with 50 minutes (URLs typically expire in 1 hour, cache for 50 min to be safe)
    const expiresAt = Date.now() + (presigned.expires_in - 600) * 1000
    this.urlCache.set(janId, { url: presigned.url, expiresAt })
    
    return presigned.url
  }

  /**
   * Clear URL cache for a specific jan_id or all cached URLs
   */
  clearUrlCache(janId?: string): void {
    if (janId) {
      this.urlCache.delete(janId)
    } else {
      this.urlCache.clear()
    }
  }
}

// Singleton instance
export const mediaService = new JanMediaService()

// Export for dependency injection or testing
export default JanMediaService