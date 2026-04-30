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
import { invoke, Channel } from '@tauri-apps/api/core'
import { SessionInfo } from '@janhq/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

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
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
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
 * Fetch that bypasses tauri_plugin_http for localhost POST requests.
 * The plugin's ReadableStream bridge does not properly deliver SSE chunks
 * from local inference servers, causing the UI to hang. This uses the
 * stream_local_http Tauri command + IPC Channel to relay response bytes
 * directly to a standard ReadableStream that the AI SDK can consume.
 */
function createLocalStreamingFetch(
  fallbackFetch: typeof httpFetch,
  parameters: Record<string, unknown>
): typeof httpFetch {
  const normalFetch = createCustomFetch(fallbackFetch, parameters)

  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    const isLocal =
      urlStr.startsWith('http://localhost:') ||
      urlStr.startsWith('http://127.0.0.1:')
    const isPost = !init?.method || init.method.toUpperCase() === 'POST'

    if (!isLocal || !isPost) return normalFetch(input, init)

    let bodyStr = (init?.body as string) ?? ''
    if (bodyStr) {
      try {
        bodyStr = JSON.stringify({ ...JSON.parse(bodyStr), ...parameters })
      } catch {
        /* non-JSON body, leave as-is */
      }
    }

    const hdrs: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers
      if (h instanceof Headers)
        h.forEach((v, k) => {
          hdrs[k] = v
        })
      else if (Array.isArray(h)) for (const [k, v] of h) hdrs[k] = String(v)
      else for (const [k, v] of Object.entries(h)) hdrs[k] = String(v)
    }

    const chunks: string[] = []
    let done = false
    let error: string | null = null
    let notifyPull: (() => void) | null = null
    let notifyFirst: (() => void) | null = null

    const channel = new Channel<{ data: string }>()
    channel.onmessage = ({ data }: { data: string }) => {
      chunks.push(data)
      notifyFirst?.()
      notifyFirst = null
      notifyPull?.()
      notifyPull = null
    }

    const markDone = () => {
      done = true
      notifyFirst?.()
      notifyFirst = null
      notifyPull?.()
      notifyPull = null
    }

    const cmdPromise = invoke<number>('stream_local_http', {
      url: urlStr,
      headers: hdrs,
      body: bodyStr,
      timeoutSecs: 600,
      onChunk: channel,
    })

    cmdPromise
      .then(() => markDone())
      .catch((e) => {
        error = String(e)
        markDone()
      })

    if (init?.signal) {
      const onAbort = () => {
        if (!error) error = 'Request aborted'
        markDone()
      }
      if (init.signal.aborted) onAbort()
      else init.signal.addEventListener('abort', onAbort, { once: true })
    }

    // Wait for either first data chunk or early connection error
    if (chunks.length === 0 && !done) {
      await new Promise<void>((r) => {
        notifyFirst = r
      })
    }

    // Connection-level error before any data: return a proper error Response
    const currentError = error as string | null
    if (currentError && chunks.length === 0) {
      const m = currentError.match(/^HTTP (\d+):\s*([\s\S]*)$/)
      return new Response(
        m ? m[2] : JSON.stringify({ error: { message: currentError } }),
        {
          status: m ? parseInt(m[1]) : 502,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const enc = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (chunks.length === 0 && !done) {
          await new Promise<void>((r) => {
            notifyPull = r
          })
        }
        while (chunks.length > 0) {
          controller.enqueue(enc.encode(chunks.shift()!))
        }
        if (done) {
          if (error) controller.error(new Error(error))
          else controller.close()
        }
      },
    })

    return new Response(readable, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
}

/**
 * Build the base URL of the running Local API Server proxy.
 * Cloud providers route inference through this proxy so `proxy.rs` can
 * dispatch by model name to the real provider endpoint.
 */
function getLocalApiServerBaseURL(): {
  baseURL: string
  apiKey: string
} {
  const { serverHost, serverPort, apiPrefix, apiKey } =
    useLocalApiServer.getState()
  // 0.0.0.0 is a listen-any address, not a dial address — clients must use
  // the loopback equivalent.
  const host = serverHost === '0.0.0.0' ? '127.0.0.1' : serverHost
  const prefix = apiPrefix.startsWith('/') ? apiPrefix : `/${apiPrefix}`
  return {
    baseURL: `http://${host}:${serverPort}${prefix}`,
    apiKey,
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
    parameters: Record<string, unknown> = {},
    reasoningOverride?: Record<string, unknown>
  ): Promise<LanguageModel> {
    const providerName = provider.provider.toLowerCase()
    const override = reasoningOverride ?? {}
    // Local providers accept the full inference-parameter bag (top_k,
    // repeat_penalty, stop_sequences, …) as body injection. Cloud providers
    // must receive ONLY the reasoning-override fields — otherwise local-only
    // keys like `top_k` leak into request bodies and strict APIs (OpenAI)
    // respond with 400 "Unknown parameter".
    const localInjected: Record<string, unknown> = {
      ...parameters,
      ...override,
    }

    switch (providerName) {
      case 'llamacpp':
        return this.createLlamaCppModel(modelId, provider, localInjected)

      case 'mlx':
        return this.createMlxModel(modelId, provider, localInjected)

      case 'foundation-models':
        return this.createFoundationModelsModel(
          modelId,
          provider,
          localInjected
        )

      case 'anthropic':
        return this.createAnthropicModel(modelId, provider, override)

      case 'openai':
        return this.createOpenAIModel(modelId, provider, override)
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
      case 'minimax':
      case 'openrouter':
      case 'huggingface':
      case 'nvidia':
        return this.createOpenAICompatibleModel(modelId, provider, override)

      case 'xai':
        return this.createXaiModel(modelId, provider, override)

      default:
        // User-registered custom OpenAI-compatible providers — keep the
        // previous behaviour (full local-merged bag) for backwards compat.
        return this.createOpenAICompatibleModel(
          modelId,
          provider,
          localInjected
        )
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

    const customFetch = createLocalStreamingFetch(httpFetch, parameters)

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

    // Use the same IPC-channel streaming fetch that llamacpp uses —
    // tauri_plugin_http's ReadableStream bridge does not relay SSE chunks.
    const baseFetch = createLocalStreamingFetch(httpFetch, parameters)

    const customFetch: typeof httpFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          httpFetch(`${baseUrl}/v1/cancel`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).catch(() => {})
        })
      }

      return baseFetch(input, init)
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
   * Create a Foundation Models model (Apple on-device) by starting the local
   * Swift server via the Tauri plugin and connecting over localhost.
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
        binaryNotFound:
          'The Foundation Models server binary is missing. Please reinstall the app.',
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

    const sessionInfo = await invoke<SessionInfo | null>(
      'plugin:foundation-models|find_foundation_models_session',
      {}
    )

    if (!sessionInfo) {
      throw new Error(
        'No running Foundation Models session. The server may have failed to start — please check the logs.'
      )
    }

    const baseUrl = `http://localhost:${sessionInfo.port}`
    const authHeaders = {
      Authorization: `Bearer ${sessionInfo.api_key}`,
      Origin: 'tauri://localhost',
    }

    const customFetch = createCustomFetch(httpFetch, parameters)

    const model = new OpenAICompatibleChatLanguageModel(modelId, {
      provider: 'foundation-models',
      headers: () => authHeaders,
      url: ({ path }) => new URL(`${baseUrl}/v1${path}`).toString(),
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
   * Create an Anthropic model using the official AI SDK.
   *
   * Requests are routed through the Local API Server proxy which dispatches
   * by model name to the configured Anthropic endpoint + key. The SDK still
   * emits `/messages` and `proxy.rs` handles that route natively.
   */
  private static createAnthropicModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    const anthropic = createAnthropic({
      apiKey: apiKey || provider.api_key || 'local',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      // Use the IPC-channel streaming fetch because the Local API Server is on
      // localhost and tauri_plugin_http's ReadableStream bridge does not relay
      // SSE chunks from loopback targets.
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    return anthropic(modelId)
  }

  /**
   * Create an OpenAI model using the official AI SDK.
   *
   * Requests are routed through the Local API Server proxy; `proxy.rs`
   * dispatches to the real OpenAI endpoint based on the `model` field and
   * the provider config registered via `register_provider_config`.
   */
  private static createOpenAIModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    const openai = createOpenAI({
      apiKey: apiKey || provider.api_key || 'local',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      // Use the IPC-channel streaming fetch because the Local API Server is on
      // localhost and tauri_plugin_http's ReadableStream bridge does not relay
      // SSE chunks from loopback targets.
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    // AI SDK v5 routes `openai(id)` through the new Responses API
    // (`POST /responses`), which the Local API Server proxy does not route.
    // `openai.chat(id)` targets `POST /chat/completions`, which `proxy.rs`
    // dispatches to the real provider via `register_provider_config`.
    return openai.chat(modelId)
  }

  /**
   * Create an XAI (Grok) model using the official AI SDK, routed through the
   * Local API Server proxy.
   */
  private static createXaiModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    const xai = createXai({
      apiKey: apiKey || provider.api_key || 'local',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      // Use the IPC-channel streaming fetch (see OpenAI factory rationale).
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    return xai(modelId)
  }

  /**
   * Create an OpenAI-compatible model for providers that support the OpenAI
   * API format. Routed through the Local API Server proxy.
   */
  private static createOpenAICompatibleModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    // Proxy replaces the outbound Authorization header with the registered
    // provider api_key, so only the local-server apiKey matters here (if set).
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    } else if (provider.api_key) {
      headers['Authorization'] = `Bearer ${provider.api_key}`
    }

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL,
      headers,
      includeUsage: true,
      // Use the IPC-channel streaming fetch (see OpenAI factory rationale).
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    // Some OpenAI-compatible providers (MiniMax, DeepSeek, Moonshot, NVIDIA
    // NIM, etc.) stream chain-of-thought inline as <think>...</think> inside
    // the assistant text instead of as a separate reasoning field. Without
    // this middleware the tags leak into the rendered message verbatim; with
    // it, the reasoning is split into a dedicated reasoning part. The
    // middleware is a no-op for providers that never emit <think> tags.
    return wrapLanguageModel({
      model: openAICompatible.languageModel(modelId),
      middleware: extractReasoningMiddleware({
        tagName: 'think',
        separator: '\n',
      }),
    })
  }
}
