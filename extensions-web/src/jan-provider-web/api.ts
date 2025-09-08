/**
 * Jan Provider API Client
 * Handles API requests to Jan backend for models and chat completions
 */

import { JanAuthService } from './auth'
import { JanModel, janProviderStore } from './store'

// JAN_API_BASE is defined in vite.config.ts

export interface JanModelsResponse {
  object: string
  data: JanModel[]
}

export interface JanChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  reasoning?: string
  reasoning_content?: string
}

export interface JanChatCompletionRequest {
  model: string
  messages: JanChatMessage[]
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  stream?: boolean
  stop?: string | string[]
}

export interface JanChatCompletionChoice {
  index: number
  message: JanChatMessage
  finish_reason: string | null
}

export interface JanChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: JanChatCompletionChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface JanChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      reasoning?: string
      reasoning_content?: string
    }
    finish_reason: string | null
  }>
}

export class JanApiClient {
  private static instance: JanApiClient
  private authService: JanAuthService

  private constructor() {
    this.authService = JanAuthService.getInstance()
  }

  static getInstance(): JanApiClient {
    if (!JanApiClient.instance) {
      JanApiClient.instance = new JanApiClient()
    }
    return JanApiClient.instance
  }

  private async makeAuthenticatedRequest<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const authHeader = await this.authService.getAuthHeader()
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
          ...options.headers,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      return response.json()
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  async getModels(): Promise<JanModel[]> {
    try {
      janProviderStore.setLoadingModels(true)
      janProviderStore.clearError()

      const response = await this.makeAuthenticatedRequest<JanModelsResponse>(
        `${JAN_API_BASE}/models`
      )

      const models = response.data || []
      janProviderStore.setModels(models)
      
      return models
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch models'
      janProviderStore.setError(errorMessage)
      janProviderStore.setLoadingModels(false)
      throw error
    }
  }

  async createChatCompletion(
    request: JanChatCompletionRequest
  ): Promise<JanChatCompletionResponse> {
    try {
      janProviderStore.clearError()

      return await this.makeAuthenticatedRequest<JanChatCompletionResponse>(
        `${JAN_API_BASE}/chat/completions`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...request,
            stream: false,
          }),
        }
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create chat completion'
      janProviderStore.setError(errorMessage)
      throw error
    }
  }

  async createStreamingChatCompletion(
    request: JanChatCompletionRequest,
    onChunk: (chunk: JanChatCompletionChunk) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    try {
      janProviderStore.clearError()
      
      const authHeader = await this.authService.getAuthHeader()
      
      const response = await fetch(`${JAN_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          ...request,
          stream: true,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      try {
        let buffer = ''
        
        while (true) {
          const { done, value } = await reader.read()
          
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6).trim()
              
              if (data === '[DONE]') {
                onComplete?.()
                return
              }

              try {
                const parsedChunk: JanChatCompletionChunk = JSON.parse(data)
                onChunk(parsedChunk)
              } catch (parseError) {
                console.warn('Failed to parse SSE chunk:', parseError, 'Data:', data)
              }
            }
          }
        }

        onComplete?.()
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error occurred')
      janProviderStore.setError(err.message)
      onError?.(err)
      throw err
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.authService.initialize()
      janProviderStore.setAuthenticated(true)
      
      // Fetch initial models
      await this.getModels()
      
      console.log('Jan API client initialized successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize API client'
      janProviderStore.setError(errorMessage)
      throw error
    } finally {
      janProviderStore.setInitializing(false)
    }
  }
}

export const janApiClient = JanApiClient.getInstance()