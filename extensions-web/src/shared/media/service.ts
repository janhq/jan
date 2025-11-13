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
}

// Singleton instance
export const mediaService = new JanMediaService()

// Export for dependency injection or testing
export default JanMediaService