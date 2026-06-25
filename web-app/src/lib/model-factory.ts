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
import { createXai } from '@ai-sdk/xai'
import { createMistral } from '@ai-sdk/mistral'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { invoke } from '@tauri-apps/api/core'
import { SessionInfo } from '@janhq/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { hasAudioSentinel, splitAudioSentinels } from './audio-sentinel'
import { hasVideoSentinel, splitVideoSentinels } from './video-sentinel'
import { isPlatformTauri } from '@/lib/platform/utils'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'
import {
  LLAMACPP_ONLY_PARAM_KEYS,
  paramsSettings,
} from '@/lib/predefinedParams'
import {
  resolveProviderCaps,
  isModelLevelRejected,
  getMutualExclusionDrops,
  getProviderApiType,
} from '@/lib/providerCaps'
import { useAppState } from '@/hooks/useAppState'

/**
 * Llama.cpp timings structure from the response
 */
interface LlamaCppTimings {
  prompt_n?: number
  predicted_n?: number
  predicted_per_second?: number
  prompt_per_second?: number
}

interface LlamaCppPromptProgress {
  total?: number
  cache?: number
  processed?: number
  time_ms?: number
}

interface LlamaCppChunk {
  timings?: LlamaCppTimings
  prompt_progress?: LlamaCppPromptProgress
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
        const state = useAppState.getState()
        const streamThreadId = state.currentStreamThreadId
        if (state.loadingModel) {
          state.updateLoadingModel(false)
        }
        if (streamThreadId) {
          state.updateThreadLoadingModel(streamThreadId, false)
        }
        if (chunk?.timings) {
          lastTimings = chunk.timings
        }
        const pp = chunk?.prompt_progress
        if (
          pp &&
          typeof pp.total === 'number' &&
          typeof pp.processed === 'number'
        ) {
          const progress = {
            total: pp.total,
            processed: pp.processed,
            cache: pp.cache ?? 0,
            time_ms: pp.time_ms ?? 0,
          }
          state.updatePromptProgress(progress)
          if (streamThreadId) {
            state.updateThreadPromptProgress(streamThreadId, progress)
          }
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

function filterParameters(
  parameters: Record<string, unknown>,
  keepLlamacppOnly: boolean
): Record<string, unknown> {
  if (keepLlamacppOnly) return parameters
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parameters)) {
    if (LLAMACPP_ONLY_PARAM_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

/**
 * Strip sampler params the active provider doesn't accept. Built-in providers
 * with strict capability tables (e.g. real OpenAI rejecting `top_k`) drop the
 * unsupported keys here so the wire request never carries them. Custom/permissive
 * providers keep everything — the user opted into an unknown OAI-compat endpoint.
 *
 * Unknown keys (not in paramsSettings) pass through untouched so non-sampler
 * fields like reasoning controls aren't affected.
 */
function stripUnsupportedSamplers(
  parameters: Record<string, unknown>,
  provider: ProviderObject,
  modelId: string
): Record<string, unknown> {
  const caps = resolveProviderCaps(provider)
  const exclusionDrops = getMutualExclusionDrops(
    parameters,
    provider.provider,
    getProviderApiType(provider)
  )
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parameters)) {
    if (exclusionDrops.has(k)) continue
    if (isModelLevelRejected(k, provider.provider, modelId)) continue
    const def = paramsSettings[k]
    if (!def) {
      out[k] = v
      continue
    }
    if (def.capability === 'client_only') {
      out[k] = v
      continue
    }
    if (def.capability === 'core') {
      out[k] = v
      continue
    }
    if (caps.supported.has(def.capability) || caps.maybe.has(def.capability)) {
      out[k] = v
    }
  }
  return out
}

/**
 * Strip Jinja-stack-trace noise and other diagnostic prelude from upstream
 * error messages so the UI shows the human-readable cause. Examples:
 *
 *   "\n------------\nWhile executing CallExpression at line 1, column 226 in
 *    source:\n...op.index0 % 2 == 0) %}{{ raise_exception('Conversation roles
 *    must alternate user...\n      ^\nError: Jinja Exception: Conversation
 *    roles must alternate user/assistant/user/assistant/..."
 *
 * becomes:
 *
 *   "Jinja Exception: Conversation roles must alternate user/assistant/..."
 *
 * Pure / no I/O so it can be exercised from tests.
 */
/**
 * Heuristic: does this upstream error look like "this parameter is not
 * accepted"? Catches OpenAI's "Unsupported parameter", Anthropic's mutual
 * exclusion, Mistral/Cohere "unknown/disallowed field" shapes, etc.
 *
 * Used to gate a one-shot retry with all our injected sampling params
 * stripped — cheap recovery without parsing per-provider error grammars.
 */
export function isSamplingParamRejection(message: string): boolean {
  if (typeof message !== 'string') return false
  return (
    /unsupported parameter/i.test(message) ||
    /is not supported with this model/i.test(message) ||
    /cannot both be specified|use only one/i.test(message) ||
    /unknown field/i.test(message) ||
    /property\s+['"`][^'"`]+['"`]\s+is unsupported/i.test(message) ||
    /field\s+['"`][^'"`]+['"`]\s+is not allowed/i.test(message) ||
    /unrecognized arguments?/i.test(message)
  )
}

export function cleanUpstreamErrorMessage(raw: string): string {
  if (typeof raw !== 'string') return raw
  let msg = raw.replace(/\r\n/g, '\n').trim()

  // Prefer the final `Error: <…>` line if present — llama.cpp's Jinja runtime
  // emits "Error: Jinja Exception: <root cause>" after a multi-line trace.
  const errorLineMatch = msg.match(/(?:^|\n)\s*Error:\s*(.+?)(?:\n|$)/)
  if (errorLineMatch && errorLineMatch[1]) {
    return errorLineMatch[1].trim()
  }

  // Otherwise drop a leading `------------` rule and "While executing …"
  // prelude that adds noise without explaining the failure.
  msg = msg.replace(/^-{3,}\s*\n?/, '').trim()
  msg = msg.replace(/^While executing[\s\S]*?\n\s*\^\s*\n?/, '').trim()
  return msg
}

/**
 * Map a transport-level fetch failure (no HTTP response — DNS, connect, TLS,
 * timeout, dropped connection) to an actionable message. `@tauri-apps/plugin-http`
 * rethrows reqwest's raw "error sending request for url …" string, which isn't
 * useful to users. Returns null when `err` is not a recognised transport error.
 */
export function describeTransportError(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err)
  if (typeof raw !== 'string' || !raw) return null
  const m = raw.toLowerCase()

  const isTransport =
    /error sending request/.test(m) ||
    /error trying to connect/.test(m) ||
    /failed to fetch|networkerror|load failed/.test(m) ||
    /connection (refused|reset|closed|aborted)/.test(m) ||
    /connection error|broken pipe/.test(m) ||
    /dns error|failed to lookup|name resolution/.test(m) ||
    /(operation|request|connection) timed out|timeout/.test(m) ||
    /tls|certificate|ssl|handshake/.test(m) ||
    /unreachable/.test(m)
  if (!isTransport) return null

  if (/dns error|failed to lookup|name resolution|unreachable/.test(m)) {
    return "Couldn't reach the provider — the address could not be resolved. Check the provider's Base URL and your internet connection."
  }
  if (/timed out|timeout/.test(m)) {
    return 'The provider took too long to respond and the request timed out. It may be overloaded or slow to start — try again.'
  }
  if (/tls|certificate|ssl|handshake/.test(m)) {
    return "Couldn't establish a secure connection to the provider (TLS/certificate error). Verify the endpoint URL."
  }
  return "Couldn't reach the provider — the connection failed. Check the provider's Base URL and your internet connection, then try again."
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url ?? ''
}

/**
 * Create a custom fetch function that injects additional parameters into the
 * request body, normalising key names for OpenAI-compatible APIs:
 * - `max_output_tokens` is remapped to `max_tokens`
 * - client-side-only keys (e.g. `ctx_len`) are stripped
 *
 * Also rewrites OpenAI-shape error bodies on non-OK responses so the inner
 * `error.message` is cleaned of stack-trace noise before the AI SDK surfaces
 * it to the UI.
 */
export function createCustomFetch(
  baseFetch: typeof globalThis.fetch,
  parameters: Record<string, unknown>,
  keepLlamacppOnly = false,
  onLlamacppServerError?: () => void
): typeof globalThis.fetch {
  const buildBody = (
    rawBody: Record<string, unknown>,
    includeOurParams: boolean
  ): Record<string, unknown> => {
    if (!includeOurParams) {
      decodeAudioSentinelsInBody(rawBody)
      decodeVideoSentinelsInBody(rawBody)
      return rawBody
    }
    const normalised: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parameters)) {
      if (CLIENT_SIDE_PARAM_KEYS.has(key)) continue
      if (!keepLlamacppOnly && LLAMACPP_ONLY_PARAM_KEYS.has(key)) continue
      const targetKey = key === 'max_output_tokens' ? 'max_tokens' : key
      normalised[targetKey] = value
    }
    const merged = { ...rawBody, ...normalised }
    if (keepLlamacppOnly && merged.stream === true) {
      merged.return_progress = true
    }
    // llama-server convention: max_tokens = -1 means "unlimited". Users who
    // set max_output_tokens = 0 in assistant params mean "no cap", not
    // "produce zero tokens" — coerce here, gated to llamacpp only because
    // OpenAI/Anthropic reject negative values.
    if (keepLlamacppOnly && merged.max_tokens === 0) {
      merged.max_tokens = -1
    }
    decodeAudioSentinelsInBody(merged)
    decodeVideoSentinelsInBody(merged)
    return merged
  }

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let rawBody: Record<string, unknown> | null = null
    if (init?.method === 'POST' || !init?.method) {
      try {
        rawBody = init?.body ? JSON.parse(init.body as string) : {}
      } catch (e) {
        throw new Error(
          `Failed to parse request body as JSON: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      init = { ...init, body: JSON.stringify(buildBody(rawBody!, true)) }
    }

    let res: Response
    try {
      res = await baseFetch(input, init)
    } catch (err) {
      const friendly = describeTransportError(err)
      if (!friendly) throw err
      throw new Error(`${friendly} (${requestUrlOf(input)})`)
    }
    if (res.ok) return res

    const isLlamacpp500 = keepLlamacppOnly && res.status === 500

    let parsed: { error?: { message?: unknown; [k: string]: unknown } } | null =
      null
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('json')) {
      try {
        parsed = JSON.parse(await res.clone().text())
      } catch {
        parsed = null
      }
    }

    const innerMessage =
      typeof parsed?.error?.message === 'string'
        ? (parsed.error.message as string)
        : null

    if (isLlamacpp500 && !innerMessage) {
      // 500 with no JSON body = router couldn't reach the child (crash). Recover.
      onLlamacppServerError?.()
      const synthMessage =
        'The model crashed and is being reloaded. Please retry.'
      const nextBody = JSON.stringify({
        error: {
          message: synthMessage,
          code: 500,
          type: 'llamacpp_server_error',
        },
      })
      return new Response(nextBody, {
        status: res.status,
        statusText: res.statusText,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (!innerMessage) return res

    // Sampling-rejection auto-retry: when the upstream complains about an
    // injected parameter (top_k on OpenAI, temp+top_p on Anthropic, etc.),
    // retry once with all our injected params stripped, surface a toast so
    // the user knows their popover knob was ignored this turn, and return
    // the bare-body response. Only attempts when we have a captured body
    // and the request looked like a chat completion / messages POST.
    if (
      rawBody &&
      res.status >= 400 &&
      res.status < 500 &&
      isSamplingParamRejection(innerMessage) &&
      Object.keys(parameters).length > 0
    ) {
      const bareInit = {
        ...init,
        body: JSON.stringify(buildBody(rawBody, false)),
      }
      const retry = await baseFetch(input, bareInit)
      if (retry.ok) {
        notifySamplingStripped(innerMessage)
        return retry
      }
      // Retry also failed — fall through to surface the cleaned original error.
    }

    const cleaned = cleanUpstreamErrorMessage(innerMessage)
    if (cleaned === innerMessage) return res
    const nextBody = JSON.stringify({
      ...parsed,
      error: { ...parsed!.error, message: cleaned },
    })
    return new Response(nextBody, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
}

let lastSamplingNoticeAt = 0
function notifySamplingStripped(reason: string): void {
  const now = Date.now()
  if (now - lastSamplingNoticeAt < 3000) return
  lastSamplingNoticeAt = now
  void import('sonner')
    .then(({ toast }) => {
      toast.warning('Sampling parameters dropped', {
        description: `${cleanUpstreamErrorMessage(reason)} — request retried without your sampling overrides. Adjust in the Sampling popover.`,
      })
    })
    .catch(() => {
      console.warn('[sampling-retry]', reason)
    })
}

/**
 * Drop `reasoning_content` / `reasoning` from assistant turns in the outgoing
 * request body. The Vercel AI SDK's openai-compatible model attaches
 * `reasoning_content` whenever a prior assistant message had a reasoning part
 * (see @ai-sdk/openai-compatible dist/index.js:260). Groq's strict validator
 * rejects this with `property 'reasoning_content' is unsupported`.
 */
export function stripAssistantReasoningInBody(
  body: Record<string, unknown>
): void {
  const messages = body.messages
  if (!Array.isArray(messages)) return
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as { role?: string; reasoning_content?: unknown; reasoning?: unknown }
    if (m.role !== 'assistant') continue
    if ('reasoning_content' in m) delete m.reasoning_content
    if ('reasoning' in m) delete m.reasoning
  }
}

/** Wraps `inner` to strip reasoning fields from assistant messages before send. */
function withAssistantReasoningStripped(
  inner: typeof globalThis.fetch
): typeof globalThis.fetch {
  return async (input, init) => {
    if ((init?.method === 'POST' || !init?.method) && init?.body) {
      try {
        const body = JSON.parse(init.body as string)
        stripAssistantReasoningInBody(body)
        init = { ...init, body: JSON.stringify(body) }
      } catch {
        // non-JSON body; fall through
      }
    }
    return inner(input, init)
  }
}

// Rewrites any sentinel-bearing text content (planted by
// CustomChatTransport.encodeAudioAttachments) back into OpenAI `input_audio`
// content parts. Mutates `body.messages` in place.
export function decodeAudioSentinelsInBody(body: Record<string, unknown>): void {
  const messages = body.messages
  if (!Array.isArray(messages)) return
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as { role?: string; content?: unknown }
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') {
      if (!hasAudioSentinel(m.content)) continue
      const split = splitAudioSentinels(m.content)
      if (split) m.content = split
      continue
    }
    if (!Array.isArray(m.content)) continue
    const next: unknown[] = []
    let touched = false
    for (const part of m.content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string' &&
        hasAudioSentinel((part as { text: string }).text)
      ) {
        const split = splitAudioSentinels((part as { text: string }).text)
        if (split) {
          next.push(...split)
          touched = true
          continue
        }
      }
      next.push(part)
    }
    if (touched) m.content = next
  }
}

// Rewrites any sentinel-bearing text content (planted by
// CustomChatTransport.encodeVideoAttachments) back into llama-server
// `input_video` content parts. Mutates `body.messages` in place. Runs after
// decodeAudioSentinelsInBody, so it also handles content already promoted to
// an array by the audio pass; the two sentinel markers are disjoint.
export function decodeVideoSentinelsInBody(body: Record<string, unknown>): void {
  const messages = body.messages
  if (!Array.isArray(messages)) return
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as { role?: string; content?: unknown }
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') {
      if (!hasVideoSentinel(m.content)) continue
      const split = splitVideoSentinels(m.content)
      if (split) m.content = split
      continue
    }
    if (!Array.isArray(m.content)) continue
    const next: unknown[] = []
    let touched = false
    for (const part of m.content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string' &&
        hasVideoSentinel((part as { text: string }).text)
      ) {
        const split = splitVideoSentinels((part as { text: string }).text)
        if (split) {
          next.push(...split)
          touched = true
          continue
        }
      }
      next.push(part)
    }
    if (touched) m.content = next
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
 * Map of model keywords to their respective reasoning tags.
 * Used for models that use tags other than the default 'think'.
 */
const REASONING_TAG_MAP: Record<string, string> = {
  gemma: 'thought',
}

/**
 * The default tag used for reasoning extraction if no specific override is found.
 */
const DEFAULT_REASONING_TAG = 'think'

/**
 * Determines the reasoning tag name based on the model ID.
 * Defaults to 'think' if no specific override is found in the map.
 */
function getReasoningTagName(modelId: string): string {
  const lowerId = modelId.toLowerCase()
  for (const [keyword, tag] of Object.entries(REASONING_TAG_MAP)) {
    if (lowerId.includes(keyword)) {
      return tag
    }
  }
  return DEFAULT_REASONING_TAG
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
    parameters = stripUnsupportedSamplers(parameters, provider, modelId)

    // Wire-format dispatch wins over name-based dispatch — custom providers
    // pointing at Anthropic-compatible proxies (LiteLLM, Bedrock gateways)
    // need the Anthropic SDK regardless of the user-chosen provider name.
    if (getProviderApiType(provider) === 'anthropic' && providerName !== 'anthropic') {
      return this.createAnthropicModel(modelId, provider, parameters)
    }

    switch (providerName) {
      case 'llamacpp':
        return this.createLlamaCppModel(modelId, provider, parameters)

      case 'mlx':
        return this.createMlxModel(modelId, provider, parameters)

      case 'anthropic':
        return this.createAnthropicModel(modelId, provider, parameters)

      case 'openai':
        return this.createOpenAIModel(modelId, provider, parameters)
      case 'google':
      case 'gemini':
        return this.createGoogleModel(modelId, provider, parameters)
      case 'azure':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'deepseek':
      case 'cohere':
      case 'perplexity':
      case 'moonshot':
      case 'minimax':
        return this.createOpenAICompatibleModel(modelId, provider)

      case 'mistral':
        return this.createMistralModel(modelId, provider, parameters)

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

    const onLlamacppServerError = provider
      ? () => {
          void (async () => {
            try {
              const { useServiceStore } = await import('@/hooks/useServiceHub')
              const hub = useServiceStore.getState().serviceHub
              await hub?.models().reloadModel(provider, modelId)
            } catch (e) {
              console.warn('[llamacpp] reload after crash failed:', e)
            }
          })()
        }
      : undefined
    const customFetch = createCustomFetch(
      httpFetch,
      parameters,
      true,
      onLlamacppServerError
    )

    return new OpenAICompatibleChatLanguageModel(modelId, {
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
    parameters = filterParameters(parameters, false)
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

    // Share the common fetch (param normalisation + error-body cleaning that
    // rebuilds upstream errors from buffered text rather than re-decoding the
    // raw stream) with every other provider, then layer MLX's /cancel-on-abort
    // on top.
    const baseCustomFetch = createCustomFetch(httpFetch, parameters)
    const customFetch: typeof globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      // When the request is aborted, also call the server's /cancel endpoint
      // to stop MLX inference immediately.
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

      return baseCustomFetch(input, init)
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
        tagName: getReasoningTagName(modelId),
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

    return openai.chat(modelId)
  }

  /**
   * Create a Mistral model using the official AI SDK. Needed for magistral-*,
   * which streams `delta.content` as an array of typed parts (thinking + text);
   * the generic openai-compatible schema rejects this with a Zod
   * "expected string, received array" error.
   */
  private static createMistralModel(
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

    const mistral = createMistral({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return mistral(modelId)
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

  // Native Google provider. Gemini 3 preview models require a
  // `thought_signature` to be round-tripped on tool-call replays, which
  // Google's /v1beta/openai compat layer does not surface — so we go native.
  // Stored base_url points at …/v1beta/openai for the compat path; the native
  // client wants the bare …/v1beta base.
  private static createGoogleModel(
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

    const keyChain = providerRemoteApiKeyChain(provider)
    const fetchImpl = createCustomFetch(getRuntimeFetch(), parameters)

    const rawBase = provider.base_url?.trim()
    const baseURL = rawBase
      ? rawBase.replace(/\/openai\/?$/, '').replace(/\/$/, '')
      : 'https://generativelanguage.googleapis.com/v1beta'

    const google = createGoogleGenerativeAI({
      apiKey: keyChain[0] ?? provider.api_key ?? '',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      fetch: fetchImpl,
    })

    return google(modelId)
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

    let fetchImpl: typeof globalThis.fetch =
      keyChain.length > 1
        ? createApiKeyRotatingFetch(
            getRuntimeFetch(),
            keyChain,
            parameters,
            'authorization-bearer'
          )
        : createCustomFetch(getRuntimeFetch(), parameters)

    if (provider.provider === 'groq') {
      fetchImpl = withAssistantReasoningStripped(fetchImpl)
    }

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL: provider.base_url || 'https://api.openai.com/v1',
      headers,
      includeUsage: true,
      fetch: fetchImpl,
    })

    const model = openAICompatible.languageModel(modelId)

    return wrapLanguageModel({
      model,
      middleware: extractReasoningMiddleware({
        tagName: getReasoningTagName(modelId),
        separator: '\n',
      }),
    })
  }
}
