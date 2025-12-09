/**
 * Jan Provider API Client
 * Handles API requests to Jan backend for models and chat completions
 */

import { Content } from '@janhq/core'
import { getSharedAuthService, JanAuthService } from '../shared'
import { ApiError } from '../shared/types/errors'
import { JAN_API_ROUTES } from './const'
import type { JanModel } from './types'

// JAN_BASE_URL is defined in vite.config.ts

// Constants
const TEMPORARY_CHAT_ID = 'temporary-chat'
const authService: JanAuthService = getSharedAuthService()

let modelsCache: JanModel[] | null = null
let modelsFetchPromise: Promise<JanModel[]> | null = null

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
    ...(isTemporaryChat
      ? {
        // For temporary chat: don't store anything, remove conversation metadata
        conversation_id: undefined,
      }
      : {
        // For regular chat: store everything, use conversation metadata
        store: true,
        store_reasoning: true,
        conversation: request.conversation_id,
        conversation_id: undefined,
      }),
  }

  return { endpoint, payload, isTemporaryChat }
}

interface JanModelSummary {
  id: string
  object: string
  owned_by: string
  created?: number
  model_display_name?: string
  category?: string
  category_order_number?: number
  model_order_number?: number
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
  supports_images?: boolean
  supports_embeddings?: boolean
  supports_reasoning?: boolean
  supports_audio?: boolean
  supports_video?: boolean
  [key: string]: unknown
}

export interface JanChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Content[] // Support both text-only and multimodal (text + images)
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
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  repetition_penalty?: number
  stream?: boolean
  stop?: string | string[]
  tools?: any[]
  tool_choice?: any
  deep_research?: boolean
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

export async function getModels(options?: { forceRefresh?: boolean }): Promise<JanModel[]> {
  try {
    const forceRefresh = options?.forceRefresh ?? false

    if (forceRefresh) {
      modelsCache = null
    } else if (modelsCache) {
      return modelsCache
    }

    if (modelsFetchPromise) {
      return modelsFetchPromise
    }

    modelsFetchPromise = (async () => {
      const response = await authService.makeAuthenticatedRequest<JanModelsResponse>(
        `${JAN_BASE_URL}${JAN_API_ROUTES.MODELS}`
      )

      const summaries = response.data || []

      const models: JanModel[] = await Promise.all(
        summaries.map(async (summary) => {
          const displayName = summary.model_display_name || summary.id
          const catalog = await fetchModelCatalog(summary.id)
          const supportedParameters = extractSupportedParameters(catalog)
          const capabilities = deriveCapabilitiesFromCatalog(catalog)
          const category = summary.category ?? deriveCategoryFromModelId(summary.id)
          const category_order_number =
            summary.category_order_number ?? (category ? 0 : Number.MAX_SAFE_INTEGER)

          return {
            id: summary.id,
            object: summary.object,
            owned_by: summary.owned_by,
            created: summary.created,
            name: displayName,
            displayName,
            capabilities,
            supportedParameters,
            model_display_name: summary.model_display_name,
            category,
            category_order_number,
            model_order_number: summary.model_order_number,
          }
        })
      )

      modelsCache = models
      
      // Store models in localStorage for default model selection
      try {
        localStorage.setItem('jan-models', JSON.stringify(models))
      } catch (storageError) {
        console.warn('Failed to store models in localStorage:', storageError)
      }
      
      return models
    })()

    return await modelsFetchPromise
  } catch (error) {
    modelsCache = null
    modelsFetchPromise = null
    throw error
  } finally {
    modelsFetchPromise = null
  }
}

export async function createChatCompletion(
  request: JanChatCompletionRequest
): Promise<JanChatCompletionResponse> {
  try {
    const { endpoint, payload } = getChatCompletionConfig(request, false)

    return await authService.makeAuthenticatedRequest<JanChatCompletionResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const err =
      error instanceof ApiError
        ? error
        : error instanceof Error
          ? error
          : new Error('Failed to create chat completion')
    throw err
  }
}

export async function createStreamingChatCompletion(
  request: JanChatCompletionRequest,
  onChunk: (chunk: JanChatCompletionChunk) => void,
  onComplete?: () => void,
  onError?: (error: Error) => void
): Promise<void> {
  try {
    const authHeader = await authService.getAuthHeader()
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
    const err =
      error instanceof ApiError
        ? error
        : error instanceof Error
          ? error
          : new Error('Unknown error occurred')
    onError?.(err)
    throw err
  }
}

export async function initializeJanApi(): Promise<void> {
  try {
    // Fetch initial models (cached for subsequent calls)
    await getModels()
    console.log('Jan API client initialized successfully')
  } catch (error) {
    const err =
      error instanceof ApiError
        ? error
        : error instanceof Error
          ? error
          : new Error('Failed to initialize API client')
    throw err
  }
}

async function fetchModelCatalog(modelId: string): Promise<JanModelCatalogResponse | null> {
  try {
    const endpoint = `${JAN_BASE_URL}${JAN_API_ROUTES.MODEL_CATALOGS}/${encodeModelIdForCatalog(modelId)}`
    return await authService.makeAuthenticatedRequest<JanModelCatalogResponse>(endpoint)
  } catch (error) {
    console.warn(`Failed to fetch catalog metadata for model "${modelId}":`, error)
    return null
  }
}

function encodeModelIdForCatalog(modelId: string): string {
  return modelId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function extractSupportedParameters(catalog: JanModelCatalogResponse | null | undefined): string[] {
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

function deriveCapabilitiesFromCatalog(catalog: JanModelCatalogResponse | null): string[] {
  const capabilities = new Set<string>()
  if (!catalog) return []

  const parameters = extractSupportedParameters(catalog)

  if (parameters.includes('tools')) {
    capabilities.add('tools')
  }

  if (parameters.includes('vision') || catalog.supports_images) {
    capabilities.add('vision')
  }

  if (catalog.supports_reasoning) {
    capabilities.add('reasoning')
  }

  // Debug log - remove after testing
  console.log('[deriveCapabilities]', catalog.id, { 
    supports_reasoning: catalog.supports_reasoning, 
    capabilities: Array.from(capabilities) 
  })

  return Array.from(capabilities)
}

function deriveCategoryFromModelId(modelId: string): string {
  if (modelId.includes('/')) {
    const [maybeCategory] = modelId.split('/')
    return maybeCategory || 'uncategorized'
  }
  return 'uncategorized'
}

/**
 * Gets the default model ID by selecting the model with:
 * 1. Lowest category_order_number
 * 2. Within that category, lowest model_order_number
 * @returns The default model ID or 'jan-v1-4b' as fallback
 */
export async function getDefaultModelId(): Promise<string> {
  try {
    const models = await getModels()
    
    if (!models || models.length === 0) {
      return 'jan-v1-4b'
    }

    // Sort by category_order_number (ascending), then model_order_number (ascending)
    const sortedModels = [...models].sort((a, b) => {
      const categoryDiff = (a.category_order_number ?? Number.MAX_SAFE_INTEGER) - 
                          (b.category_order_number ?? Number.MAX_SAFE_INTEGER)
      if (categoryDiff !== 0) return categoryDiff
      
      return (a.model_order_number ?? Number.MAX_SAFE_INTEGER) - 
             (b.model_order_number ?? Number.MAX_SAFE_INTEGER)
    })

    return sortedModels[0].id
  } catch (error) {
    console.error('Failed to get default model:', error)
    return 'jan-v1-4b'
  }
}
