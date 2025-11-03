/**
 * Jan Provider API Client
 * Handles API requests to Jan backend for models and chat completions
 */

import { getSharedAuthService, JanAuthService } from '../shared'
import { ApiError } from '../shared/types/errors'
import { JAN_API_ROUTES } from './const'
import { JanModel, janProviderStore } from './store'

// JAN_BASE_URL is defined in vite.config.ts

// Constants
const TEMPORARY_CHAT_ID = 'temporary-chat'

/**
 * Determines the appropriate API endpoint and request payload based on chat type
 * @param request - The chat completion request
 * @returns Object containing endpoint URL and processed request payload
 */
function getChatCompletionConfig(request: JanChatCompletionRequest, stream: boolean = false) {
  const isTemporaryChat = request.conversation_id === TEMPORARY_CHAT_ID
  const endpoint = `${JAN_BASE_URL}${JAN_API_ROUTES.CHAT_COMPLETIONS}`

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

interface JanModelSummary {
  id: string
  object: string
  owned_by: string
  created?: number
}

interface JanModelsResponse {
  object: string
  data: JanModelSummary[]
}

interface JanModelCatalogResponse {
  id: string
  supported_parameters?: {
    names?: string[]
    default?: Record<string, unknown>
  }
  extras?: {
    supported_parameters?: string[]
    default_parameters?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
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
  private modelsCache: JanModel[] | null = null
  private modelsFetchPromise: Promise<JanModel[]> | null = null

  private constructor() {
    this.authService = getSharedAuthService()
  }

  static getInstance(): JanApiClient {
    if (!JanApiClient.instance) {
      JanApiClient.instance = new JanApiClient()
    }
    return JanApiClient.instance
  }

  async getModels(options?: { forceRefresh?: boolean }): Promise<JanModel[]> {
    try {
      const forceRefresh = options?.forceRefresh ?? false

      if (forceRefresh) {
        this.modelsCache = null
      } else if (this.modelsCache) {
        return this.modelsCache
      }

      if (this.modelsFetchPromise) {
        return this.modelsFetchPromise
      }

      janProviderStore.setLoadingModels(true)
      janProviderStore.clearError()

      this.modelsFetchPromise = (async () => {
        const response = await this.authService.makeAuthenticatedRequest<JanModelsResponse>(
          `${JAN_BASE_URL}${JAN_API_ROUTES.MODELS}`
        )

        const summaries = response.data || []

        const models: JanModel[] = await Promise.all(
          summaries.map(async (summary) => {
            const supportedParameters = await this.fetchSupportedParameters(summary.id)
            const capabilities = this.deriveCapabilitiesFromParameters(supportedParameters)

            return {
              id: summary.id,
              object: summary.object,
              owned_by: summary.owned_by,
              created: summary.created,
              capabilities,
              supportedParameters,
            }
          })
        )

        this.modelsCache = models
        janProviderStore.setModels(models)

        return models
      })()

      return await this.modelsFetchPromise
    } catch (error) {
      this.modelsCache = null
      this.modelsFetchPromise = null

      const errorMessage = error instanceof ApiError ? error.message :
                          error instanceof Error ? error.message : 'Failed to fetch models'
      janProviderStore.setError(errorMessage)
      janProviderStore.setLoadingModels(false)
      throw error
    } finally {
      this.modelsFetchPromise = null
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
      // Fetch initial models (cached for subsequent calls)
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

  private async fetchSupportedParameters(modelId: string): Promise<string[]> {
    try {
      const endpoint = `${JAN_BASE_URL}${JAN_API_ROUTES.MODEL_CATALOGS}/${this.encodeModelIdForCatalog(modelId)}`
      const catalog = await this.authService.makeAuthenticatedRequest<JanModelCatalogResponse>(endpoint)
      return this.extractSupportedParameters(catalog)
    } catch (error) {
      console.warn(`Failed to fetch catalog metadata for model "${modelId}":`, error)
      return []
    }
  }

  private encodeModelIdForCatalog(modelId: string): string {
    return modelId
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
  }

  private extractSupportedParameters(catalog: JanModelCatalogResponse | null | undefined): string[] {
    if (!catalog) {
      return []
    }

    const primaryNames = catalog.supported_parameters?.names
    if (Array.isArray(primaryNames) && primaryNames.length > 0) {
      return [...new Set(primaryNames)]
    }

    const extraNames = catalog.extras?.supported_parameters
    if (Array.isArray(extraNames) && extraNames.length > 0) {
      return [...new Set(extraNames)]
    }

    return []
  }

  private deriveCapabilitiesFromParameters(parameters: string[]): string[] {
    const capabilities = new Set<string>()

    if (parameters.includes('tools')) {
      capabilities.add('tools')
    }

    return Array.from(capabilities)
  }
}

export const janApiClient = JanApiClient.getInstance()
