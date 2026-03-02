/**
 * Model Factory
 *
 * This factory provides a unified interface for creating language models from various providers.
 * It handles the complexity of initializing different AI SDK providers with their specific
 * configurations and returns a standard LanguageModel interface.
 *
 * Supported Providers:
 * - llamacpp: Local models via llama.cpp (requires running session)
 * - mlx: Local models via MLX-Swift on Apple Silicon (requires running session)
 * - anthropic: Claude models via Anthropic API (@ai-sdk/anthropic v2.0)
 * - google/gemini: Gemini models via Google Generative AI API (@ai-sdk/google v2.0)
 * - openai: OpenAI models via OpenAI API (@ai-sdk/openai)
 * - OpenAI-compatible: Azure, Groq, Together, Fireworks, DeepSeek, Mistral, Cohere, etc.
 *
 * Usage:
 * ```typescript
 * const model = await ModelFactory.createModel(modelId, provider, parameters)
 * ```
 *
 * The factory automatically:
 * - Handles provider-specific authentication and headers
 * - Manages llamacpp session discovery and connection
 * - Configures custom headers for each provider
 * - Returns a unified LanguageModel interface compatible with Vercel AI SDK
 */

/**
 * Inference parameters for customizing model behavior
 */
export interface ModelParameters {
  temperature?: number
  top_k?: number
  top_p?: number
  repeat_penalty?: number
  max_output_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop_sequences?: string[]
}

import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import {
  createOpenAICompatible,
  MetadataExtractor,
  OpenAICompatibleChatLanguageModel,
} from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createXai } from '@ai-sdk/xai'
import { invoke } from '@tauri-apps/api/core'
import { SessionInfo } from '@janhq/core'
import { isPlatformTauri } from '@/lib/platform'
import { useThinkingLevel, type ThinkingLevel } from '@/hooks/useThinkingLevel'

// Use Tauri HTTP client on desktop, native fetch on web
// Tauri's fetch supports bypassing CORS on desktop; web uses native fetch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const httpFetch: typeof fetch = isPlatformTauri()
  // Dynamic import to avoid loading Tauri plugin in web builds
  ? ((...args: Parameters<typeof fetch>) => {
      return import('@tauri-apps/plugin-http').then(({ fetch: f }) =>
        (f as unknown as typeof fetch)(...args)
      )
    }) as typeof fetch
  : fetch

/**
 * Llama.cpp timings structure from the response
 */
interface LlamaCppTimings {
  prompt_n?: number
  predicted_n?: number
  predicted_per_second?: number
  prompt_per_second?: number
}

interface LlamaCppChunk {
  timings?: LlamaCppTimings
}

/**
 * Custom metadata extractor for MLX that extracts timing information
 * and converts it to token usage format. MLX uses the same timing structure
 * as llama.cpp.
 */
const providerMetadataExtractor: MetadataExtractor = {
  extractMetadata: async ({ parsedBody }: { parsedBody: unknown }) => {
    const body = parsedBody as LlamaCppChunk
    if (body?.timings) {
      return {
        providerMetadata: {
          promptTokens: body.timings.prompt_n ?? null,
          completionTokens: body.timings.predicted_n ?? null,
          tokensPerSecond: body.timings.predicted_per_second ?? null,
          promptPerSecond: body.timings.prompt_per_second ?? null,
        },
      }
    }
    return undefined
  },
  createStreamExtractor: () => {
    let lastTimings: LlamaCppTimings | undefined

    return {
      processChunk: (parsedChunk: unknown) => {
        const chunk = parsedChunk as LlamaCppChunk
        if (chunk?.timings) {
          lastTimings = chunk.timings
        }
      },
      buildMetadata: () => {
        if (lastTimings) {
          return {
            providerMetadata: {
              promptTokens: lastTimings.prompt_n ?? null,
              completionTokens: lastTimings.predicted_n ?? null,
              tokensPerSecond: lastTimings.predicted_per_second ?? null,
              promptPerSecond: lastTimings.prompt_per_second ?? null,
            },
          }
        }
        return undefined
      },
    }
  },
}

/**
 * Create a custom fetch function that injects additional parameters into the request body
 */
function createCustomFetch(
  baseFetch: typeof httpFetch,
  parameters: Record<string, unknown>
): typeof httpFetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only transform POST requests with JSON body
    if (init?.method === 'POST' || !init?.method) {
      const body = init?.body ? JSON.parse(init.body as string) : {}

      // Merge parameters into the request body
      const mergedBody = { ...body, ...parameters }

      init = {
        ...init,
        body: JSON.stringify(mergedBody),
      }
    }

    return baseFetch(input, init)
  }
}

/**
 * Convert message content (string or array) to a plain string.
 */
function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n')
  }
  return String(content)
}

/**
 * Convert Chat Completions message content to OpenAI Responses API content array format.
 * User messages use "input_text", assistant messages use "output_text".
 */
function normalizeContentToResponsesApiFormat(
  content: unknown,
  role: string
): Array<{ type: string; text: string }> {
  const contentType = role === 'assistant' ? 'output_text' : 'input_text'
  if (typeof content === 'string') {
    return [{ type: contentType, text: content }]
  }
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => ({ type: contentType, text: c.text! }))
  }
  return [{ type: contentType, text: String(content) }]
}

/**
 * Transform an OpenAI Responses API SSE stream into a Chat Completions SSE stream.
 * Maps response.output_text.delta events to chat completion chunks and
 * response.completed to a stop chunk followed by [DONE].
 */
function createResponsesApiToCompletionsStream(
  body: ReadableStream<Uint8Array>,
  model: string
): ReadableStream<Uint8Array> {
  const chatId = `chatcmpl-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  const reader = body.getReader()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue
            const eventData = line.slice(6)
            if (eventData === '[DONE]') continue

            try {
              const event = JSON.parse(eventData) as { type: string; delta?: string }

              if (event.type === 'response.output_text.delta') {
                const chunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }],
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
              } else if (event.type === 'response.completed') {
                const stopChunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`))
                controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      } finally {
        reader.releaseLock()
        controller.close()
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Thinking / Reasoning parameter builders
// ---------------------------------------------------------------------------

type AnthropicThinkingResult = {
  bodyParams: Record<string, unknown>
  extraBetaHeaders: string[]
  systemPromptAddition?: string
}

type OpenAIReasoningResult = {
  bodyParams: Record<string, unknown>
  systemPromptAddition?: string
}

// Models supporting output_config.effort including 'max' + adaptive thinking
const ANTHROPIC_EFFORT_MAX_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6']

// Model IDs that support output_config.effort but NOT 'max' (need extra beta header)
const ANTHROPIC_EFFORT_NO_MAX_MODELS = ['claude-opus-4-5-20251101']

// Prefixes for models with NO thinking support at all (Claude 3.5 and below, except 3.7)
const ANTHROPIC_NO_THINKING_PREFIXES = [
  'claude-3-5-',
  'claude-3-haiku',
  'claude-3-sonnet',
  'claude-3-opus',
  'claude-2',
  'claude-instant',
]

function buildAnthropicThinkingParams(
  modelId: string,
  level: ThinkingLevel
): AnthropicThinkingResult {
  if (level === 'None') return { bodyParams: {}, extraBetaHeaders: [] }

  // No thinking support
  const noThinking = ANTHROPIC_NO_THINKING_PREFIXES.some((prefix) =>
    modelId.startsWith(prefix)
  )
  if (noThinking) return { bodyParams: {}, extraBetaHeaders: [] }

  // Effort + adaptive thinking including 'max' (Sonnet 4.6, Opus 4.6, etc.)
  if (ANTHROPIC_EFFORT_MAX_MODELS.some((m) => modelId.includes(m))) {
    const effortMap: Record<ThinkingLevel, string> = {
      Max: 'max',
      High: 'high',
      Medium: 'medium',
      Low: 'low',
      None: 'low',
    }
    return {
      bodyParams: {
        thinking: { type: 'adaptive' },
        output_config: { effort: effortMap[level] },
      },
      extraBetaHeaders: [],
    }
  }

  // Opus 4.5: supports effort but not 'max', requires effort-2025-11-24 beta header
  if (ANTHROPIC_EFFORT_NO_MAX_MODELS.includes(modelId)) {
    const effortMap: Partial<Record<ThinkingLevel, string>> = {
      Max: 'high',
      High: 'high',
      Medium: 'medium',
      Low: 'low',
    }
    return {
      bodyParams: {
        output_config: { effort: effortMap[level] ?? 'low' },
      },
      extraBetaHeaders: ['effort-2025-11-24'],
      systemPromptAddition: level === 'Max' ? 'Thinking effort: Max' : undefined,
    }
  }

  // Budget token models: Claude 3.7 Sonnet, Sonnet 4, Haiku 4.5, etc.
  const budgetMap: Partial<Record<ThinkingLevel, number>> = {
    Max: 32000,
    High: 16000,
    Medium: 8000,
    Low: 2000,
  }
  return {
    bodyParams: {
      thinking: { type: 'enabled', budget_tokens: budgetMap[level] ?? 2000 },
    },
    extraBetaHeaders: [],
  }
}

// OpenAI models that don't support 'none'/'minimal' effort — map to 'low' + system prompt
const OPENAI_NO_NONE_MODELS = ['gpt-5.2-codex', 'gpt-5.3-codex']

// OpenAI models that don't support 'xhigh' effort — map Max to 'high'
const OPENAI_NO_XHIGH_MODELS = ['gpt-5.1-codex', 'gpt-5', 'gpt-5-mini']

function buildOpenAIReasoningParams(
  modelId: string,
  level: ThinkingLevel
): OpenAIReasoningResult {
  const supportsNone = !OPENAI_NO_NONE_MODELS.some(
    (m) => modelId === m || modelId.startsWith(`${m}-`)
  )
  const supportsXhigh = !OPENAI_NO_XHIGH_MODELS.some(
    (m) => modelId === m || modelId.startsWith(`${m}-`)
  )

  let effort: string
  let systemPromptAddition: string | undefined

  switch (level) {
    case 'None':
      if (supportsNone) {
        effort = 'minimal'
      } else {
        effort = 'low'
        systemPromptAddition = 'Reasoning effort: Minimal'
      }
      break
    case 'Low':
      effort = 'low'
      break
    case 'Medium':
      effort = 'medium'
      break
    case 'High':
      effort = 'high'
      break
    case 'Max':
      effort = supportsXhigh ? 'xhigh' : 'high'
      break
    default:
      effort = 'medium'
  }

  return { bodyParams: { reasoning: { effort } }, systemPromptAddition }
}

// ---------------------------------------------------------------------------

/**
 * Factory for creating language models based on provider type.
 * Supports native AI SDK providers (Anthropic, Google) and OpenAI-compatible providers.
 */
export class ModelFactory {
  /**
   * Create a language model instance based on the provider configuration
   */
  static async createModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): Promise<LanguageModel> {
    const providerName = provider.provider.toLowerCase()

    switch (providerName) {
      case 'llamacpp':
        return this.createLlamaCppModel(modelId, provider, parameters)

      case 'mlx':
        return this.createMlxModel(modelId, provider, parameters)

      case 'anthropic':
        return this.createAnthropicModel(modelId, provider)

      case 'anthropic-sub':
        return this.createAnthropicSubModel(modelId, provider)

      case 'openai-sub':
        return this.createOpenAISubModel(modelId, provider)

      case 'openai':
        return this.createOpenAIModel(modelId, provider)
      case 'google':
      case 'gemini':
      case 'azure':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'deepseek':
      case 'mistral':
      case 'cohere':
      case 'perplexity':
      case 'moonshot':
        return this.createOpenAICompatibleModel(modelId, provider)

      case 'xai':
        return this.createXaiModel(modelId, provider)
      default:
        return this.createOpenAICompatibleModel(modelId, provider, parameters)
    }
  }

  /**
   * Create a llamacpp model by starting the model and finding the running session
   */
  private static async createLlamaCppModel(
    modelId: string,
    provider?: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): Promise<LanguageModel> {
    // Start the model first if provider is available
    if (provider) {
      try {
        const { useServiceStore } = await import('@/hooks/useServiceHub')
        const serviceHub = useServiceStore.getState().serviceHub

        if (serviceHub) {
          await serviceHub.models().startModel(provider, modelId)
        }
      } catch (error) {
        console.error('Failed to start llamacpp model:', error)
        throw new Error(
          `Failed to start model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        )
      }
    }

    // Get session info which includes port and api_key (Tauri only)
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
    const sessionInfo = await tauriInvoke<SessionInfo | null>(
      'plugin:llamacpp|find_session_by_model',
      { modelId }
    )

    if (!sessionInfo) {
      throw new Error(`No running session found for model: ${modelId}`)
    }

    const customFetch = createCustomFetch(httpFetch, parameters)

    const model = new OpenAICompatibleChatLanguageModel(modelId, {
      provider: 'llamacpp',
      headers: () => ({
        Authorization: `Bearer ${sessionInfo.api_key}`,
        Origin: 'tauri://localhost',
      }),
      url: ({ path }) => {
        const url = new URL(`http://localhost:${sessionInfo.port}/v1${path}`)
        return url.toString()
      },
      includeUsage: true,
      fetch: customFetch,
      metadataExtractor: providerMetadataExtractor,
    })

    return wrapLanguageModel({
      model,
      middleware: extractReasoningMiddleware({
        tagName: 'think',
        separator: '\n',
      }),
    })
  }

  /**
   * Create an MLX model by starting the model and finding the running session.
   * MLX uses the same OpenAI-compatible API pattern as llamacpp.
   */
  private static async createMlxModel(
    modelId: string,
    provider?: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): Promise<LanguageModel> {
    // Start the model first if provider is available
    if (provider) {
      try {
        const { useServiceStore } = await import('@/hooks/useServiceHub')
        const serviceHub = useServiceStore.getState().serviceHub

        if (serviceHub) {
          await serviceHub.models().startModel(provider, modelId)
        }
      } catch (error) {
        console.error('Failed to start MLX model:', error)
        throw new Error(
          `Failed to start model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        )
      }
    }

    // Get session info which includes port and api_key (Tauri only)
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
    const sessionInfo = await tauriInvoke<SessionInfo | null>(
      'plugin:mlx|find_mlx_session_by_model',
      { modelId }
    )

    if (!sessionInfo) {
      throw new Error(`No running MLX session found for model: ${modelId}`)
    }

    const baseUrl = `http://localhost:${sessionInfo.port}`
    const authHeaders = {
      Authorization: `Bearer ${sessionInfo.api_key}`,
      Origin: 'tauri://localhost',
    }

    // Custom fetch that merges parameters and calls /cancel on abort
    const customFetch: typeof httpFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      if (init?.method === 'POST' || !init?.method) {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        const mergedBody = { ...body, ...parameters }
        init = { ...init, body: JSON.stringify(mergedBody) }
      }

      // When the request is aborted, also call the server's /cancel endpoint
      // to stop MLX inference immediately
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          httpFetch(`${baseUrl}/v1/cancel`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).catch(() => {
            // Ignore cancel request errors
          })
        })
      }

      return httpFetch(input, init)
    }

    const model = new OpenAICompatibleChatLanguageModel(modelId, {
      provider: 'mlx',
      headers: () => authHeaders,
      url: ({ path }) => {
        const url = new URL(`${baseUrl}/v1${path}`)
        return url.toString()
      },
      fetch: customFetch,
      metadataExtractor: providerMetadataExtractor,
    })

    return wrapLanguageModel({
      model: model,
      middleware: extractReasoningMiddleware({
        tagName: 'think',
        separator: '\n',
      }),
    })
  }

  /**
   * Create an Anthropic model using the official AI SDK
   */
  private static createAnthropicModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified (e.g., anthropic-version)
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const anthropic = createAnthropic({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: createCustomFetch(httpFetch, parameters),
    })

    return anthropic(modelId)
  }

  /**
   * Create an Anthropic (Sub) model using OAuth bearer token authentication.
   * Uses `Authorization: Bearer <token>` with the oauth-2025-04-20 beta header.
   *
   * CORS strategy:
   * - Tauri: @tauri-apps/plugin-http bypasses CORS at the OS level. Uses the
   *   provider's base_url directly.
   * - Web dev: requests are intercepted by a custom fetch and redirected to
   *   /api/anthropic (same-origin), which the Vite dev server proxies to
   *   Anthropic's API server-to-server (no CORS involved).
   */
  private static createAnthropicSubModel(
    modelId: string,
    provider: ProviderObject
  ): LanguageModel {
    // Determine thinking params for this model + current thinking level
    const thinkingLevel = useThinkingLevel.getState().thinkingLevel
    const thinkingResult = buildAnthropicThinkingParams(modelId, thinkingLevel)

    const betaValue = ['oauth-2025-04-20', ...thinkingResult.extraBetaHeaders].join(', ')
    const requiredHeaders: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betaValue,
    }

    // Allow provider-defined custom_header to override defaults
    if (provider.custom_header) {
      provider.custom_header.forEach((h) => {
        requiredHeaders[h.header] = h.value
      })
    }

    // Custom fetch that:
    // 1. In Tauri: passes through to the Tauri HTTP plugin (CORS bypassed at OS level)
    // 2. In web: intercepts requests to api.anthropic.com and redirects to /api/anthropic
    //    (local same-origin endpoint that the Vite middleware proxies server-to-server)
    //
    // Thinking parameters are injected directly into the request body here.
    const anthropicSubFetch: typeof httpFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = new URL(input instanceof URL ? input.toString() : String(input))
      const headers = new Headers(init?.headers)
      headers.delete('x-api-key')
      headers.set('Authorization', `Bearer ${provider.api_key}`)
      Object.entries(requiredHeaders).forEach(([key, value]) => {
        headers.set(key, value)
      })

      // Inject thinking params and optional system prompt addition into the body
      let modifiedInit = init
      if (
        init?.body &&
        (Object.keys(thinkingResult.bodyParams).length > 0 ||
          thinkingResult.systemPromptAddition)
      ) {
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        const mergedBody = { ...body, ...thinkingResult.bodyParams }
        if (thinkingResult.systemPromptAddition) {
          const existing = typeof mergedBody.system === 'string' ? mergedBody.system : ''
          mergedBody.system = existing
            ? `${thinkingResult.systemPromptAddition}\n\n${existing}`
            : thinkingResult.systemPromptAddition
        }
        modifiedInit = { ...init, body: JSON.stringify(mergedBody) }
      }

      // In web mode: redirect requests to the local /api/anthropic middleware
      if (!isPlatformTauri()) {
        // Extract the path from the Anthropic URL
        // e.g., https://api.anthropic.com/v1/messages → /messages
        const pathMatch = url.pathname.match(/\/v1(.*)$/)
        const endpoint = pathMatch ? pathMatch[1] : '/messages'

        // Pass base URL to the middleware via a custom header
        headers.set('x-anthropic-base-url', provider.base_url || 'https://api.anthropic.com/v1')

        return httpFetch(`/api/anthropic${endpoint}`, {
          ...(modifiedInit ?? init),
          method: (modifiedInit ?? init)?.method || 'POST',
          headers,
        })
      }

      // In Tauri: use provider's base URL directly and pass through to Tauri HTTP
      return httpFetch(input, {
        ...(modifiedInit ?? init),
        headers,
      })
    }

    const anthropic = createAnthropic({
      // apiKey must be non-empty to pass the SDK's internal guard; the actual
      // Authorization header is set by anthropicSubFetch above.
      apiKey: provider.api_key || 'bearer',
      // Use provider's configured base URL; in web mode it will be intercepted
      // by anthropicSubFetch and redirected to /api/anthropic
      baseURL: provider.base_url || 'https://api.anthropic.com/v1',
      fetch: anthropicSubFetch,
    })

    return anthropic(modelId)
  }

  /**
   * Create an OpenAI (Sub) model using OAuth bearer token authentication.
   * Uses the OpenAI Responses API format (input/instructions) rather than
   * the standard Chat Completions format (messages).
   *
   * CORS strategy (same pattern as Anthropic Sub):
   * - Tauri: @tauri-apps/plugin-http bypasses CORS at the OS level. Request and
   *   response are transformed directly in the custom fetch function.
   * - Web dev: requests are intercepted and redirected to /api/openai-sub
   *   (same-origin), which the Vite dev server transforms and proxies
   *   server-to-server (no CORS involved).
   */
  private static createOpenAISubModel(
    modelId: string,
    provider: ProviderObject
  ): LanguageModel {
    // Determine reasoning params for this model + current thinking level
    const thinkingLevel = useThinkingLevel.getState().thinkingLevel
    const reasoningResult = buildOpenAIReasoningParams(modelId, thinkingLevel)

    const openAISubFetch: typeof httpFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const headers = new Headers(init?.headers)
      // Replace x-api-key (set by OpenAI SDK) with bearer token
      headers.delete('x-api-key')
      headers.set('Authorization', `Bearer ${provider.api_key}`)

      if (!isPlatformTauri()) {
        // Web mode: redirect to the Vite middleware for server-to-server proxying
        headers.set(
          'x-openai-sub-endpoint',
          provider.base_url || 'https://chatgpt.com/backend-api/codex/responses'
        )
        // Pass reasoning params to the middleware via custom headers
        headers.set('x-reasoning-effort', (reasoningResult.bodyParams.reasoning as { effort: string }).effort)
        if (reasoningResult.systemPromptAddition) {
          headers.set('x-reasoning-system-addition', reasoningResult.systemPromptAddition)
        }
        return httpFetch('/api/openai-sub', {
          ...init,
          method: init?.method || 'POST',
          headers,
        })
      }

      // Tauri mode: transform Chat Completions → Responses API and vice versa
      if (init?.body) {
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        const messages =
          (body.messages as Array<{ role: string; content: unknown }>) || []
        const systemMessage = messages.find((m) => m.role === 'system')
        const conversationMessages = messages.filter((m) => m.role !== 'system')

        const transformedBody: Record<string, unknown> = {
          model: body.model,
          store: false,
          stream: body.stream ?? true,
          ...reasoningResult.bodyParams,
          input: conversationMessages.map((m) => ({
            type: 'message',
            role: m.role,
            content: normalizeContentToResponsesApiFormat(m.content, m.role),
          })),
        }

        // Build instructions from system message, optionally prepending effort hint
        const baseInstructions = systemMessage
          ? contentToString(systemMessage.content)
          : undefined
        const instructions = reasoningResult.systemPromptAddition
          ? baseInstructions
            ? `${reasoningResult.systemPromptAddition}\n\n${baseInstructions}`
            : reasoningResult.systemPromptAddition
          : baseInstructions

        if (instructions) {
          transformedBody.instructions = instructions
        }

        const endpoint =
          provider.base_url || 'https://chatgpt.com/backend-api/codex/responses'
        const response = await httpFetch(endpoint, {
          ...init,
          headers,
          body: JSON.stringify(transformedBody),
        })

        // Transform the Responses API SSE stream back to Chat Completions SSE
        if (response.body && body.stream !== false) {
          const transformedStream = createResponsesApiToCompletionsStream(
            response.body,
            body.model as string
          )
          return new Response(transformedStream, {
            status: response.status,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            },
          })
        }

        return response
      }

      return httpFetch(input, { ...init, headers })
    }

    // Use a placeholder base URL; all requests are intercepted by openAISubFetch
    const openAICompatible = createOpenAICompatible({
      name: 'openai-sub',
      baseURL: 'https://placeholder.openai-sub.internal/v1',
      headers: {},
      fetch: openAISubFetch,
    })

    return openAICompatible.languageModel(modelId)
  }

  /**
   * Create an OpenAI model using the official AI SDK
   */
  private static createOpenAIModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const openai = createOpenAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: createCustomFetch(httpFetch, parameters),
    })

    return openai(modelId)
  }

  /**
   * Create an XAI (Grok) model using the official AI SDK
   */
  private static createXaiModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const xai = createXai({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: createCustomFetch(httpFetch, parameters),
    })

    return xai(modelId)
  }

  /**
   * Create an OpenAI-compatible model for providers that support the OpenAI API format
   */
  private static createOpenAICompatibleModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    // Add authorization header if api_key is present
    if (provider.api_key) {
      headers['Authorization'] = `Bearer ${provider.api_key}`
    }

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL: provider.base_url || 'https://api.openai.com/v1',
      headers,
      includeUsage: true,
      fetch: createCustomFetch(httpFetch, parameters),
    })

    return openAICompatible.languageModel(modelId)
  }
}
