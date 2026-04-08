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
  max_context_tokens?: number
  auto_compact?: boolean
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
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { invoke } from '@tauri-apps/api/core'
import { SessionInfo } from '@janhq/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { isPlatformTauri } from '@/lib/platform/utils'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'

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
 * Keys from inference parameters that are client-side only and must not
 * be forwarded in the HTTP body to remote APIs.
 */
const CLIENT_SIDE_PARAM_KEYS: ReadonlySet<string> = new Set([
  'ctx_len',
  'max_context_tokens',
  'auto_compact',
])

/**
 * Create a custom fetch function that injects additional parameters into the
 * request body, normalising key names for OpenAI-compatible APIs:
 * - `max_output_tokens` is remapped to `max_tokens`
 * - client-side-only keys (e.g. `ctx_len`) are stripped
 */
function createCustomFetch(
  baseFetch: typeof globalThis.fetch,
  parameters: Record<string, unknown>
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'POST' || !init?.method) {
      const body = init?.body ? JSON.parse(init.body as string) : {}

      // Normalise and merge inference parameters
      const normalised: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (CLIENT_SIDE_PARAM_KEYS.has(key)) continue
        // max_output_tokens → max_tokens (OpenAI-compatible field name)
        const targetKey = key === 'max_output_tokens' ? 'max_tokens' : key
        normalised[targetKey] = value
      }

      init = { ...init, body: JSON.stringify({ ...body, ...normalised }) }
    }

    return baseFetch(input, init)
  }
}

type ApiKeyHeaderMode = 'authorization-bearer' | 'x-api-key'

/** Retries with the next key when the upstream returns 401, 403, or 429. */
function createApiKeyRotatingFetch(
  baseFetch: typeof globalThis.fetch,
  apiKeys: string[],
  parameters: Record<string, unknown>,
  headerMode: ApiKeyHeaderMode
): typeof globalThis.fetch {
  const inner = createCustomFetch(baseFetch, parameters)
  if (apiKeys.length <= 1) {
    return inner
  }
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    for (let i = 0; i < apiKeys.length; i++) {
      const key = apiKeys[i]!
      const nextHeaders = new Headers(init?.headers as HeadersInit | undefined)
      if (headerMode === 'authorization-bearer') {
        nextHeaders.set('Authorization', `Bearer ${key}`)
      } else {
        nextHeaders.set('x-api-key', key)
      }
      const res = await inner(input, { ...init, headers: nextHeaders })
      if ([401, 403, 429].includes(res.status) && i < apiKeys.length - 1) {
        res.body?.cancel().catch(() => {})
        continue
      }
      return res
    }
    throw new Error('API key rotation exhausted')
  }
}

function getRuntimeFetch(): typeof globalThis.fetch {
  const maybeWindow = globalThis as typeof globalThis & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
  const hasTauriRuntime =
    typeof maybeWindow.__TAURI__ !== 'undefined' ||
    typeof maybeWindow.__TAURI_INTERNALS__ !== 'undefined'

  return isPlatformTauri() && hasTauriRuntime
    ? (httpFetch as typeof globalThis.fetch)
    : globalThis.fetch
}

/**
 * Custom fetch for Foundation Models that routes through Tauri IPC
 * instead of HTTP, emulating an OpenAI-compatible fetch interface.
 */
function createFoundationModelsFetch(
  parameters: Record<string, unknown>
): typeof globalThis.fetch {
  return async (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const rawBody = init?.body ? JSON.parse(init.body as string) : {}
    const body = { ...rawBody, ...parameters }
    const isStreaming = body.stream === true

    if (!isStreaming) {
      const result = await invoke<string>(
        'plugin:foundation-models|foundation_models_chat_completion',
        { body: JSON.stringify(body) }
      )
      return new Response(result, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const requestId = crypto.randomUUID()
    const { listen } = await import('@tauri-apps/api/event')

    let unlistenFn: (() => void) | null = null
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder()

        unlistenFn = await listen(
          `foundation-models-stream-${requestId}`,
          (event: { payload: { data?: string; done?: boolean; error?: string } }) => {
            const payload = event.payload
            if (payload.done) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              try {
                controller.close()
              } catch {
                /* already closed */
              }
              unlistenFn?.()
            } else if (payload.error) {
              try {
                controller.error(new Error(payload.error))
              } catch {
                /* already errored */
              }
              unlistenFn?.()
            } else if (payload.data) {
              controller.enqueue(
                encoder.encode(`data: ${payload.data}\n\n`)
              )
            }
          }
        )

        invoke(
          'plugin:foundation-models|foundation_models_chat_completion_stream',
          { body: JSON.stringify(body), requestId }
        ).catch((err) => {
          try {
            controller.error(err)
          } catch {
            /* already errored */
          }
          unlistenFn?.()
        })
      },
      cancel() {
        unlistenFn?.()
        invoke(
          'plugin:foundation-models|abort_foundation_models_stream',
          { requestId }
        ).catch(() => {})
      },
    })

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
}

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

      case 'foundation-models':
        return this.createFoundationModelsModel(modelId, provider, parameters)

      case 'anthropic':
        return this.createAnthropicModel(modelId, provider, parameters)

      case 'openai':
        return this.createOpenAIModel(modelId, provider, parameters)
      case 'google':
      case 'gemini':
        return this.createGoogleModel(modelId, provider)
      case 'azure':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'deepseek':
      case 'mistral':
      case 'cohere':
      case 'perplexity':
      case 'moonshot':
      case 'minimax':
        return this.createOpenAICompatibleModel(modelId, provider)

      case 'xai':
        return this.createXaiModel(modelId, provider, parameters)

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

    // Get session info which includes port and api_key
    const sessionInfo = await invoke<SessionInfo | null>(
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

    // Get session info which includes port and api_key
    const sessionInfo = await invoke<SessionInfo | null>(
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
   * Create a Foundation Models model (Apple on-device) via direct Tauri IPC
   * to the fm-rs Rust bindings — no HTTP server involved.
   */
  private static async createFoundationModelsModel(
    modelId: string,
    provider?: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): Promise<LanguageModel> {
    const availability = await invoke<string>(
      'plugin:foundation-models|check_foundation_models_availability',
      {}
    )

    if (availability !== 'available') {
      const messages: Record<string, string> = {
        notEligible:
          'Apple Intelligence is not supported on this device. An Apple Silicon Mac (M1 or later) with macOS 26+ is required.',
        appleIntelligenceNotEnabled:
          'Apple Intelligence is not enabled. Please enable it in System Settings > Apple Intelligence & Siri.',
        modelNotReady:
          'The Apple on-device model is still preparing. Please wait and try again shortly.',
        unavailable:
          'Apple Foundation Models are currently unavailable on this device.',
      }
      throw new Error(messages[availability] ?? messages.unavailable)
    }

    if (provider) {
      try {
        const { useServiceStore } = await import('@/hooks/useServiceHub')
        const serviceHub = useServiceStore.getState().serviceHub

        if (serviceHub) {
          await serviceHub.models().startModel(provider, modelId)
        }
      } catch (error) {
        console.error('Failed to start Foundation Models:', error)
        throw new Error(
          `Failed to start model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        )
      }
    }

    const loaded = await invoke<boolean>(
      'plugin:foundation-models|is_foundation_models_loaded',
      {}
    )

    if (!loaded) {
      throw new Error(
        'No running Foundation Models session. The model may have failed to load — please check the logs.'
      )
    }

    const customFetch = createFoundationModelsFetch(parameters)

    const model = new OpenAICompatibleChatLanguageModel(modelId, {
      provider: 'foundation-models',
      headers: () => ({}),
      url: ({ path }) => `foundation-models://local/v1${path}`,
      fetch: customFetch as typeof httpFetch,
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

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'x-api-key'
          )
        : createCustomFetch(getRuntimeFetch(), parameters)

    const anthropic = createAnthropic({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return anthropic(modelId)
  }

  /**
   * Create a Google/Gemini model using the official AI SDK
   */
  private static createGoogleModel(
    modelId: string,
    provider: ProviderObject
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const keyChain = providerRemoteApiKeyChain(provider)
    const google = createGoogleGenerativeAI({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

    return google(modelId)
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

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer'
          )
        : createCustomFetch(getRuntimeFetch(), parameters)

    const openai = createOpenAI({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
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

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer'
          )
        : createCustomFetch(getRuntimeFetch(), parameters)

    const xai = createXai({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
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

    const keyChain = providerRemoteApiKeyChain(provider)
    if (keyChain.length === 1) {
      headers['Authorization'] = `Bearer ${keyChain[0]}`
    }

    const fetchImpl =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer'
          )
        : createCustomFetch(getRuntimeFetch(), parameters)

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL: provider.base_url || 'https://api.openai.com/v1',
      headers,
      includeUsage: true,
      fetch: fetchImpl,
    })

    return openAICompatible.languageModel(modelId)
  }
}
