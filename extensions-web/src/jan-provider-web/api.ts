/**
 * Jan Provider API Client
 * Handles API requests to Jan backend for models and chat completions
 */

import { getSharedAuthService, JanAuthService } from '../shared'
import { JanModel, janProviderStore } from './store'
import { ApiError } from '../shared/types/errors'

// JAN_API_BASE is defined in vite.config.ts

// Constants
const TEMPORARY_CHAT_ID = 'temporary-chat'

/**
 * Determines the appropriate API endpoint and request payload based on chat type
 * @param request - The chat completion request
 * @returns Object containing endpoint URL and processed request payload
 */
function getChatCompletionConfig(request: JanChatCompletionRequest, stream: boolean = false) {
  const isTemporaryChat = request.conversation_id === TEMPORARY_CHAT_ID

  // For temporary chats, use the stateless /chat/completions endpoint
  // For regular conversations, use the stateful /conv/chat/completions endpoint
  const endpoint = isTemporaryChat
    ? `${JAN_API_BASE}/chat/completions`
    : `${JAN_API_BASE}/conv/chat/completions`

  const payload = {
    ...request,
    stream,
    ...(isTemporaryChat ? {
      // For temporary chat: don't store anything, remove conversation metadata
      conversation_id: undefined,
    } : {
      // For regular chat: store everything, use conversation metadata
      store: true,
      store_reasoning: true,
      conversation: request.conversation_id,
      conversation_id: undefined,
    })
  }

  return { endpoint, payload, isTemporaryChat }
}

export interface JanModelsResponse {
  object: string
  data: JanModel[]
}

export interface JanChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  reasoning?: string
  reasoning_content?: string
  tool_calls?: any[]
}

export interface JanChatCompletionRequest {
  model: string
  messages: JanChatMessage[]
  conversation_id?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  stream?: boolean
  stop?: string | string[]
  tools?: any[]
  tool_choice?: any
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
      tool_calls?: any[]
    }
    finish_reason: string | null
  }>
}

export class JanApiClient {
  private static instance: JanApiClient
  private authService: JanAuthService

  private constructor() {
    this.authService = getSharedAuthService()
  }

  static getInstance(): JanApiClient {
    if (!JanApiClient.instance) {
      JanApiClient.instance = new JanApiClient()
    }
    return JanApiClient.instance
  }

  async getModels(): Promise<JanModel[]> {
    try {
      janProviderStore.setLoadingModels(true)
      janProviderStore.clearError()

      const response = await this.authService.makeAuthenticatedRequest<JanModelsResponse>(
        `${JAN_API_BASE}/conv/models`
      )

      const models = response.data || []
      janProviderStore.setModels(models)
      
      return models
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message :
                          error instanceof Error ? error.message : 'Failed to fetch models'
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

      const { endpoint, payload } = getChatCompletionConfig(request, false)

      return await this.authService.makeAuthenticatedRequest<JanChatCompletionResponse>(
        endpoint,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      )
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message :
                          error instanceof Error ? error.message : 'Failed to create chat completion'
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
      const { endpoint, payload } = getChatCompletionConfig(request, true)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(payload),
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
      const err = error instanceof ApiError ? error :
                 error instanceof Error ? error : new Error('Unknown error occurred')
      janProviderStore.setError(err.message)
      onError?.(err)
      throw err
    }
  }

  async initialize(): Promise<void> {
    try {
      janProviderStore.setAuthenticated(true)
      // Fetch initial models
      await this.getModels()
      console.log('Jan API client initialized successfully')
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message :
                          error instanceof Error ? error.message : 'Failed to initialize API client'
      janProviderStore.setError(errorMessage)
      throw error
    } finally {
      janProviderStore.setInitializing(false)
    }
  }
}

export const janApiClient = JanApiClient.getInstance()