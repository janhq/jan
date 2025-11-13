/**
 * Web Uploads Service with Media Server Integration
 * Handles image and document uploads for extensions-web
 */

import { getSharedAuthService } from '../../shared/auth'
import { ExtensionTypeEnum, type RAGExtension, type IngestAttachmentsResult } from '@janhq/core'

declare const JAN_BASE_URL: string

/**
 * Generate a simple unique ID
 */
function generateId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// Feature flag for media server integration
const ENABLE_MEDIA_SERVER = true // Set to true to enable jan_id system

// Constants for media server API
const MEDIA_CONFIG = {
  baseUrl: `${JAN_BASE_URL}/media`, // Use JAN_BASE_URL from vite config
  serviceKey: 'changeme-media-key', // Should come from config
  maxFileSize: 10 * 1024 * 1024, // 10MB
  supportedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
}

// Simple media upload interface
interface MediaUploadResponse {
  id: string              // jan_abc123
  mime: string           
  bytes: number          
  deduped: boolean       
  presigned_url?: string 
}

/**
 * Upload result returned from ingestion
 */
export interface UploadResult {
  id: string
  url?: string
  size?: number
  chunkCount?: number
}

/**
 * Attachment interface for uploads
 */
export interface Attachment {
  type: 'image' | 'document'
  name: string
  path?: string
  dataUrl?: string
  base64?: string
  mimeType?: string
  fileType?: string
  size?: number
}

/**
 * Uploads service interface
 */
export interface UploadsService {
  ingestImage(threadId: string, attachment: Attachment): Promise<UploadResult>
  ingestFileAttachment(threadId: string, attachment: Attachment): Promise<UploadResult>
}

export class WebUploadsService implements UploadsService {
  private static instance: WebUploadsService

  private constructor() {}

  static getInstance(): WebUploadsService {
    if (!WebUploadsService.instance) {
      WebUploadsService.instance = new WebUploadsService()
    }
    return WebUploadsService.instance
  }
  
  /**
   * Upload image to Jan media server and return jan_id reference
   */
  async ingestImage(threadId: string, attachment: Attachment): Promise<UploadResult> {
    console.log('🎯 ingestImage called:', {
      threadId,
      attachmentName: attachment.name,
      attachmentType: attachment.type,
      hasDataUrl: !!attachment.dataUrl,
      hasBase64: !!attachment.base64,
      ENABLE_MEDIA_SERVER
    })

    if (attachment.type !== 'image') {
      throw new Error('ingestImage: attachment is not image')
    }

    // Check if media server integration is enabled
    if (!ENABLE_MEDIA_SERVER) {
      // Fallback to placeholder behavior
      console.log('❌ Media server integration disabled, using placeholder upload')
      await new Promise((r) => setTimeout(r, 100))
      return { id: generateId() }
    }

    try {
      // Validate attachment has image data
      if (!attachment.dataUrl && !attachment.base64) {
        console.error('❌ No image data available:', { attachment })
        throw new Error('No image data available for upload')
      }

      // Construct data URL if needed
      const dataUrl = attachment.dataUrl || 
        (attachment.base64 && attachment.mimeType 
          ? `data:${attachment.mimeType};base64,${attachment.base64}`
          : null)

      if (!dataUrl) {
        console.error('❌ Cannot construct data URL from attachment:', { attachment })
        throw new Error('Cannot construct data URL from attachment')
      }

      console.log(`📤 Uploading image to media server: ${attachment.name}`)
      console.log('📍 Upload endpoint:', `${MEDIA_CONFIG.baseUrl}/v1/media`)
      
      // Upload to Jan media server
      const response = await this.uploadToMediaServer(
        dataUrl,
        attachment.name,
        threadId
      )

      console.log('✅ Media server upload successful:', {
        id: response.id,
        bytes: response.bytes,
        deduped: response.deduped,
        presigned_url: response.presigned_url ? 'present' : 'none'
      })

      // Validate that we got a proper jan_id
      if (!response.id.startsWith('jan_')) {
        console.error('Invalid media server response - ID does not start with jan_:', response.id)
        throw new Error('Invalid jan_id format from server')
      }

      return {
        id: response.id,        // jan_abc123 format
        size: response.bytes,   // Server-reported size
        url: response.presigned_url, // Optional presigned URL
      }
    } catch (error) {
      console.error('❌ Failed to upload image to media server:', error)
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // DO NOT FALL BACK - throw the error so base64 is used as last resort
      throw error
    }
  }

  /**
   * Upload image to media server via API
   */
  private async uploadToMediaServer(
    dataUrl: string, 
    filename: string, 
    userId: string
  ): Promise<MediaUploadResponse> {
    
    // Get authentication token
    const token = await this.getAuthToken()

    const requestBody = {
      source: {
        type: 'data_url',
        data_url: dataUrl,
      },
      filename,
      user_id: userId,
    }

    const response = await fetch(`${MEDIA_CONFIG.baseUrl}/v1/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Media-Service-Key': MEDIA_CONFIG.serviceKey,
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Media server upload failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    
    // Validate response format
    if (!result.id || !result.id.startsWith('jan_')) {
      throw new Error('Invalid response: missing or invalid media ID')
    }

    return result
  }

  /**
   * Get authentication token using Jan Auth Service
   */
  private async getAuthToken(): Promise<string> {
    try {
      const authService = getSharedAuthService()
      const token = await authService.getValidAccessToken()
      return token
    } catch (error) {
      console.error('Failed to get valid access token:', error)
      throw new Error('Authentication failed - unable to get valid token')
    }
  }

  /**
   * Ingest document attachment using existing RAG extension
   */
  async ingestFileAttachment(threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document') {
      throw new Error('ingestFileAttachment: attachment is not document')
    }

    // Note: ExtensionManager needs to be imported from the context where this is used
    // This is a placeholder that should be implemented based on your architecture
    throw new Error('RAG extension integration not yet implemented in extensions-web')
  }

  /**
   * Check if media server integration is available
   */
  async checkMediaServerHealth(): Promise<boolean> {
    if (!ENABLE_MEDIA_SERVER) {
      return false
    }

    try {
      const response = await fetch(`${MEDIA_CONFIG.baseUrl}/healthz`, {
        method: 'GET',
        headers: {
          'X-Media-Service-Key': MEDIA_CONFIG.serviceKey,
        }
      })
      return response.ok
    } catch (error) {
      console.warn('Media server health check failed:', error)
      return false
    }
  }

  /**
   * Get current configuration status
   */
  getConfiguration() {
    return {
      mediaServerEnabled: ENABLE_MEDIA_SERVER,
      baseUrl: MEDIA_CONFIG.baseUrl,
      serviceType: ENABLE_MEDIA_SERVER ? 'media-server' : 'placeholder',
      version: '1.0.0'
    }
  }
}

/**
 * Singleton instance
 */
export const webUploadsService = WebUploadsService.getInstance()

export default WebUploadsService
