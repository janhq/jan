import { fetchJsonWithAuth } from '@/lib/api-client'

declare const JAN_API_BASE_URL: string

export interface ImageGenerationRequest {
  prompt: string
  n?: number
  size?: string
  response_format?: string
  conversation_id?: string
  store?: boolean
}

export interface ImageGenerationData {
  url: string
  id: string
}

export interface ImageGenerationResponse {
  created: number
  data: ImageGenerationData[]
}

export const imageGenerationService = {
  /**
   * Generate images using the images/generations endpoint
   */
  generateImage: async (
    request: ImageGenerationRequest
  ): Promise<ImageGenerationResponse> => {
    return fetchJsonWithAuth<ImageGenerationResponse>(
      `${JAN_API_BASE_URL}v1/images/generations`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    )
  },
}
