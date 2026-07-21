import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  type LanguageModelUsage,
  jsonSchema,
  InvalidToolInputError,
} from 'ai'
import { repairToolArgs } from './toolCallRepair'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { useAttachments } from '@/hooks/useAttachments'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import {
  WEB_SEARCH_DESCRIPTION,
  WEB_SEARCH_INPUT_SCHEMA,
  WEB_FETCH_DESCRIPTION,
  WEB_FETCH_INPUT_SCHEMA,
} from '@/lib/webSearchTool'
import { useAppState } from '@/hooks/useAppState'
import { unloadLlamaModel, getLoadedModels } from '@janhq/tauri-plugin-llamacpp-api'
import { ExtensionManager } from '@/lib/extension'
import { getLlamacppExtension } from '@/lib/llamacppRouterProps'
import {
  tokensForThinkingBudgetLevel,
  isThinkingBudgetLevelKey,
} from '@/lib/thinkingBudget'
import { buildReasoningProviderOptions } from '@/lib/reasoningProviderOptions'
import {
  ExtensionTypeEnum,
  VectorDBExtension,
  type MCPTool,
} from '@janhq/core'
import {
  trimMessages,
  compactMessages,
  estimateTokens,
  type ContextManagerConfig,
} from './context-manager'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator'
import { isRouterModelSelectable } from '@/lib/mcp-router-model-filter'
import { encodeAudioSentinel, parseAudioDataUrl } from '@/lib/audio-sentinel'
import { encodeVideoSentinel, parseVideoDataUrl } from '@/lib/video-sentinel'
import { isPredefinedRemoteProvider } from '@/lib/providerCaps'
import { paramsSettings } from '@/lib/predefinedParams'

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void
export type StreamingTokenSpeedCallback = (
  tokenCount: number,
  elapsedMs: number
) => void
export type OnFinishCallback = (params: {
  message: UIMessage
  isAbort?: boolean
}) => void
/** Partial assistant output replayed as a prefill to resume a stopped turn. */
export type ContinuationContent = { text?: string; reasoning?: string }
export type ServiceHub = {
  rag(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
  mcp(): {
    getTools(): Promise<MCPTool[]>
    /** TauriMCPService only */
    getToolsForServers?(serverNames: string[]): Promise<MCPTool[]>
    /** TauriMCPService only */
    getServerSummaries?(): Promise<
      Array<{ name: string; capabilities: string[]; description: string }>
    >
  }
}

const SCHEMA_PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'array',
  'object',
])

const SCHEMA_NODE_MAP_KEYS = new Set(['properties', 'patternProperties', 'definitions', '$defs'])
const SCHEMA_NODE_LIST_KEYS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems'])

// Per-model sidebar keys whose values should be forwarded into each chat-
// completion request body as defaults. In router mode these can't be CLI args
// — the router is one process serving every model — so they have to ride
// along on each call. Assistant `parameters` override these in the merge.
const MODEL_SAMPLING_SETTING_KEYS = [
  'temperature',
  'top_k',
  'top_p',
  'min_p',
  'repeat_last_n',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
] as const

function extractModelSamplingDefaults(
  model: Model | null | undefined
): Record<string, unknown> {
  if (!model?.settings) return {}
  const out: Record<string, unknown> = {}
  for (const key of MODEL_SAMPLING_SETTING_KEYS) {
    const raw = model.settings[key]?.controller_props?.value
    if (raw === undefined || raw === null || raw === '') continue
    // Sidebar inputs are string-typed even when controller_props.type is
    // 'number'; coerce so the request body matches the OpenAI schema.
    if (typeof raw === 'string') {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      out[key] = n
    } else {
      out[key] = raw
    }
  }
  return out
}

/**
 * Per-model chat-template kwargs the user set in the model settings sidebar,
 * stored as an object under `settings.chat_template_kwargs`. Only primitive
 * values are forwarded; `enable_thinking` is owned by the reasoning control
 * and is dropped here.
 */
function extractModelTemplateKwargs(
  model: Model | null | undefined
): Record<string, boolean | number | string> {
  const raw: unknown =
    model?.settings?.chat_template_kwargs?.controller_props?.value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean | number | string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'enable_thinking') continue
    const t = typeof value
    if (t === 'boolean' || t === 'number' || t === 'string') {
      out[key] = value as boolean | number | string
    }
  }
  return out
}

/**
 * `thinking_budget_tokens` is stored as a symbolic level (low/medium/high/
 * xhigh/unlimited), not a frozen absolute count — llama.cpp's --fit can pick
 * a runtime n_ctx far from the configured/default size, and that's only known
 * once the model is actually loaded. Resolve against the live n_ctx here, at
 * send time, instead of whatever context size was in scope when the level
 * was picked in ChatInput.
 */
async function resolveThinkingBudgetTokens(
  model: Model | null | undefined,
  modelId: string | undefined
): Promise<number | undefined> {
  const rawLevel = model?.settings?.thinking_budget_tokens?.controller_props?.value
  if (!isThinkingBudgetLevelKey(rawLevel)) return undefined
  if (rawLevel === 'unlimited') return -1

  let contextSize: number | undefined
  if (modelId) {
    try {
      contextSize = (await getLlamacppExtension()?.getModelProps?.(modelId))?.nCtx
    } catch {
      // Model not loaded yet or router unreachable; fall through to configured/default.
    }
  }
  if (!contextSize) {
    const configured = model?.settings?.ctx_len?.controller_props?.value
    contextSize =
      typeof configured === 'number'
        ? configured
        : typeof configured === 'string' && configured !== ''
          ? Number(configured)
          : undefined
  }
  return tokensForThinkingBudgetLevel(rawLevel, contextSize || 8192)
}

/**
 * Coerce a schema-node slot into a valid sub-schema. Some tool generators
 * emit shorthand like `{ "properties": { "foo": "string" } }` instead of
 * `{ "properties": { "foo": { "type": "string" } } }`. llama.cpp's
 * json-schema-to-grammar rejects the former with
 * `Unrecognized schema: "string"`. We expand the shorthand here so the
 * grammar generator sees a well-formed schema.
 */
function coerceSchemaNode(value: unknown): unknown {
  if (typeof value === 'string' && SCHEMA_PRIMITIVE_TYPES.has(value)) {
    return normalizeToolInputSchemaValue({ type: value })
  }
  return normalizeToolInputSchemaValue(value)
}

function normalizeToolInputSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolInputSchemaValue)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, childValue]) => {
      // Schema-node containers: their direct children are sub-schemas, so a
      // bare-string primitive type name should expand to `{ type: <name> }`.
      if (
        SCHEMA_NODE_MAP_KEYS.has(key) &&
        childValue &&
        typeof childValue === 'object' &&
        !Array.isArray(childValue)
      ) {
        return [
          key,
          Object.fromEntries(
            Object.entries(childValue as Record<string, unknown>).map(
              ([propKey, propVal]) => [propKey, coerceSchemaNode(propVal)]
            )
          ),
        ]
      }
      if (SCHEMA_NODE_LIST_KEYS.has(key) && Array.isArray(childValue)) {
        return [key, childValue.map(coerceSchemaNode)]
      }
      if (key === 'items') {
        if (Array.isArray(childValue)) return [key, childValue.map(coerceSchemaNode)]
        return [key, coerceSchemaNode(childValue)]
      }
      return [key, normalizeToolInputSchemaValue(childValue)]
    })
  )

  const hasDescription = Object.prototype.hasOwnProperty.call(normalized, 'description')
  const hasType = Object.prototype.hasOwnProperty.call(normalized, 'type')
  const hasNestedSchemaKeywords =
    Object.prototype.hasOwnProperty.call(normalized, 'properties') ||
    Object.prototype.hasOwnProperty.call(normalized, 'items') ||
    Object.prototype.hasOwnProperty.call(normalized, 'anyOf') ||
    Object.prototype.hasOwnProperty.call(normalized, 'oneOf') ||
    Object.prototype.hasOwnProperty.call(normalized, 'allOf') ||
    Object.prototype.hasOwnProperty.call(normalized, '$ref')

  if (normalized.type === 'object' && !Object.prototype.hasOwnProperty.call(normalized, 'properties')) {
    normalized.properties = {}
  }

  if (hasDescription && !hasType && !hasNestedSchemaKeywords) {
    normalized.type = 'string'
  }

  // llama.cpp's json-schema-to-grammar emits PCRE `\d` for these formats,
  // which GBNF rejects; the failed grammar silently disables tool-call JSON.
  if (
    typeof normalized.format === 'string' &&
    LLAMACPP_BROKEN_STRING_FORMATS.has(normalized.format as string)
  ) {
    delete normalized.format
  }

  // `pattern` is the same PCRE-to-GBNF trap as `format`: any pattern that
  // uses `\d`, `\w`, or `\s` (extremely common in date/time/uuid regexes)
  // fails GBNF compilation. The model still has `type` and `description`.
  if (
    typeof normalized.pattern === 'string' &&
    PCRE_SHORTHAND.test(normalized.pattern as string)
  ) {
    delete normalized.pattern
  }

  return normalized
}

const LLAMACPP_BROKEN_STRING_FORMATS = new Set(['date', 'time', 'date-time'])
const PCRE_SHORTHAND = /\\[dDwWsS]/

/**
 * Returns true when an assistant message carries no content the model would
 * actually render: no text, no tool call, no file, no reasoning. These appear
 * when a generation fails before any chunk arrives — the AI SDK leaves a bare
 * placeholder in the message list with empty parts.
 */
function isAssistantMessageEmpty(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false
  const parts = Array.isArray(message.parts) ? message.parts : []
  if (parts.length === 0) return true
  return parts.every((part) => {
    const type = (part as { type?: string }).type
    if (type === 'text' || type === 'reasoning') {
      const text = (part as { text?: string }).text
      return typeof text !== 'string' || text.trim().length === 0
    }
    return false
  })
}

/**
 * Merge `b`'s parts onto `a`'s parts. When adjacent text parts meet at the
 * boundary, they're concatenated with a blank-line separator so the merged
 * message reads as one continuous turn rather than two.
 */
function mergeMessageParts(
  a: UIMessage['parts'],
  b: UIMessage['parts']
): UIMessage['parts'] {
  const aParts = Array.isArray(a) ? [...a] : []
  const bParts = Array.isArray(b) ? b : []
  for (const part of bParts) {
    const last = aParts[aParts.length - 1]
    if (
      last &&
      (last as { type?: string }).type === 'text' &&
      (part as { type?: string }).type === 'text' &&
      typeof (last as { text?: string }).text === 'string' &&
      typeof (part as { text?: string }).text === 'string'
    ) {
      aParts[aParts.length - 1] = {
        ...(last as object),
        text: `${(last as { text: string }).text}\n\n${(part as { text: string }).text}`,
      } as (typeof aParts)[number]
    } else {
      aParts.push(part)
    }
  }
  return aParts as UIMessage['parts']
}

/**
 * Enforce strict user/assistant alternation on the message history before it
 * goes to the model.
 *
 * Most chat templates (Gemma, Mistral, Llama 3, Anthropic Claude API,
 * tool-calling Qwen variants, etc.) reject two consecutive turns with the
 * same role — either via a Jinja `raise_exception` or a 400 from the
 * provider. When a generation fails mid-stream the AI SDK still keeps the
 * user message in its state but never appends an assistant reply, so the
 * next send produces `[user, user]` and the next request 500s on the
 * server side. We fix that here by:
 *
 * 1. Dropping assistant placeholders with no content (failed turns).
 * 2. Merging any remaining adjacent user messages by concatenating their
 *    text parts and appending their non-text parts. This preserves all of
 *    the user's content — nothing is silently dropped.
 *
 * Adjacent assistant messages are intentionally left alone: the Anthropic
 * serial-tool-use wave-split in `sendMessages` deliberately produces them.
 */
/**
 * Drop image parts (and AI-SDK `image` parts) from the history when the
 * active model lacks the `vision` capability. Without this, switching from
 * a vision-capable model to a text-only model mid-thread sends `file` parts
 * the new model can't interpret — most OpenAI-compatible providers 400 on
 * unsupported content types, and llama-server with a non-vision template
 * either errors or silently strips the content (depending on template).
 *
 * Audio sentinels (planted by `encodeAudioAttachments`) are not file parts
 * at this point yet — they're still `file` parts with `audio/*` mediaType —
 * so this only matches `image/*`. Files inlined via `mapUserInlineAttachments`
 * are already text and not affected.
 */
/**
 * Pull llama-server's structured context-overflow fields out of an
 * APICallError. The AI SDK's OpenAI-compatible provider zod-parses the
 * error body and strips unknown keys from `error.data`, but the raw text
 * survives on `error.responseBody`. Parse that to recover the original
 * `n_prompt_tokens` / `n_ctx` siblings so the UI can render an actionable
 * "Used X of Y context tokens" line instead of just the keyword-based
 * banner.
 *
 * Returns null unless both fields are present and numeric.
 */
export function extractContextInfoFromError(
  error: unknown
): { nPromptTokens: number; nCtx: number } | null {
  if (!error || typeof error !== 'object') return null
  const responseBody = (error as { responseBody?: unknown }).responseBody
  if (typeof responseBody !== 'string' || responseBody.length === 0) return null
  try {
    const parsed = JSON.parse(responseBody) as {
      error?: { n_prompt_tokens?: unknown; n_ctx?: unknown }
    }
    const inner = parsed?.error
    if (!inner || typeof inner !== 'object') return null
    const nPromptTokens = (inner as Record<string, unknown>).n_prompt_tokens
    const nCtx = (inner as Record<string, unknown>).n_ctx
    if (typeof nPromptTokens !== 'number' || typeof nCtx !== 'number') return null
    return { nPromptTokens, nCtx }
  } catch {
    return null
  }
}

export function unwrapRetryError(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error
  const errors = (error as { errors?: unknown }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    return errors[errors.length - 1] ?? error
  }
  return error
}

const RETRY_PREFIX_RE = /^Failed after \d+ attempts\. Last error: /
const RETRY_NONRETRYABLE_RE = /^Failed after \d+ attempts with non-retryable error: '(.+)'$/s

export function stripRetryErrorWrapper(message: string): string {
  if (typeof message !== 'string') return message
  const m = message.match(RETRY_NONRETRYABLE_RE)
  if (m) return m[1]
  return message.replace(RETRY_PREFIX_RE, '')
}

export function stripUnsupportedImageParts(
  messages: UIMessage[],
  modelSupportsVision: boolean
): UIMessage[] {
  if (modelSupportsVision) return messages
  return messages.map((message) => {
    if (!Array.isArray(message.parts) || message.parts.length === 0) {
      return message
    }
    let touched = false
    const nextParts = message.parts.filter((part) => {
      const type = (part as { type?: string }).type
      if (type === 'image') {
        touched = true
        return false
      }
      if (type === 'file') {
        const mediaType = (part as { mediaType?: string }).mediaType
        if (typeof mediaType === 'string' && mediaType.startsWith('image/')) {
          touched = true
          return false
        }
      }
      return true
    })
    if (!touched) return message
    return { ...message, parts: nextParts } as UIMessage
  })
}

const RESOLVED_TOOL_STATES = new Set([
  'output-available',
  'output-error',
  'output-denied',
])

/**
 * Mark unresolved tool-call parts on assistant messages as errored so the
 * history sent to the next model still satisfies the "every tool call has a
 * matching tool result" invariant most chat templates enforce.
 *
 * Triggered by: a tool-call sequence is interrupted mid-flight (parse error,
 * abort, network drop). The AI SDK leaves the assistant message with a
 * tool-* part whose `state` is `input-streaming` / `input-available` — no
 * result was ever appended. Sending that history back to a strict template
 * (Gemma, Mistral, alternation-checking Qwen variants) trips a Jinja
 * `raise_exception` on the next turn.
 *
 * We synthesise an `output-error` so the orphan reads as a failed tool call
 * with a brief explanation, preserving the user's intent and the assistant's
 * reasoning instead of dropping the whole turn.
 */
export function resolveOrphanToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    const parts = Array.isArray(message.parts) ? message.parts : []
    if (parts.length === 0) return message

    let mutated = false
    const nextParts = parts.map((part) => {
      const type = (part as { type?: string }).type
      if (typeof type !== 'string' || !type.startsWith('tool-')) return part
      const state = (part as { state?: string }).state
      if (typeof state === 'string' && RESOLVED_TOOL_STATES.has(state)) {
        return part
      }
      mutated = true
      return {
        ...(part as object),
        state: 'output-error',
        errorText:
          (part as { errorText?: string }).errorText ??
          'Tool call did not complete (interrupted by an earlier error).',
      } as typeof part
    })

    if (!mutated) return message
    return { ...message, parts: nextParts }
  })
}

/**
 * Split any assistant message whose parts place non-tool content (text,
 * reasoning, file) AFTER tool-call parts into consecutive assistant messages,
 * one per "wave". This is required for two reasons:
 *
 * 1. Correctness: the Claude API rejects an assistant turn that interleaves
 *    tool_use with text (error 400); it needs tool_use / tool_result pairing.
 * 2. Prompt-cache stability: when a tool-call turn completes, the AI SDK stores
 *    the follow-up text in the SAME assistant UIMessage as the tool call, so
 *    `convertToModelMessages` renders `assistant(tool-call, text)` then
 *    `tool(result)`. But that turn was generated in two requests — the cache
 *    was seeded with `assistant(tool-call)` then `tool(result)`, with no text
 *    yet. Splitting restores the generated order `assistant(tool-call)` ->
 *    `tool(result)` -> `assistant(text)`, so the prefix stays byte-identical
 *    across turns and llama.cpp reuses the KV cache.
 *
 * A message with no tool parts, or with all non-tool parts before the tool
 * parts, is returned unchanged.
 */
export function splitAssistantToolWaves(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') return [message]

    const parts = Array.isArray(message.parts) ? message.parts : []
    if (parts.length === 0) return [message]

    const isToolPart = (p: (typeof parts)[number]) =>
      typeof p.type === 'string' && p.type.startsWith('tool-')

    const waves: (typeof parts)[] = []
    let currentWave: typeof parts = []
    let seenToolParts = false

    for (const part of parts) {
      if (isToolPart(part)) {
        seenToolParts = true
        currentWave.push(part)
      } else if (seenToolParts) {
        waves.push(currentWave)
        currentWave = [part]
        seenToolParts = false
      } else {
        currentWave.push(part)
      }
    }
    if (currentWave.length > 0) waves.push(currentWave)

    if (waves.length <= 1) return [message]

    return waves.map((waveParts, i) => ({
      ...message,
      id: `${message.id}_w${i}`,
      parts: waveParts,
    }))
  })
}

export function coalesceMessagesForAlternation(
  messages: UIMessage[]
): UIMessage[] {
  const filtered = messages.filter((m) => !isAssistantMessageEmpty(m))
  if (filtered.length <= 1) return filtered

  const out: UIMessage[] = [filtered[0]]
  for (let i = 1; i < filtered.length; i++) {
    const prev = out[out.length - 1]
    const cur = filtered[i]
    if (prev.role === 'user' && cur.role === 'user') {
      out[out.length - 1] = {
        ...prev,
        parts: mergeMessageParts(prev.parts, cur.parts),
      }
    } else {
      out.push(cur)
    }
  }
  return out
}

const TOOL_RESPONSE_ONLY = /^<tool_response>[\s\S]*<\/tool_response>$/

/**
 * A "genuine" user query is a user-role message with non-empty text that isn't
 * entirely a <tool_response> wrapper. Qwen3.5+ chat templates raise
 * "No user query found in messages" when none survives — e.g. the user deletes
 * the only real user turn (leaving orphaned assistant/tool turns) or token
 * eviction drops it. Guard the send so we fail with a clear message instead.
 */
export function hasGenuineUserQuery(messages: UIMessage[]): boolean {
  return messages.some((m) => {
    if (m.role !== 'user') return false
    const text = (m.parts ?? [])
      .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
      .join('')
      .trim()
    return text.length > 0 && !TOOL_RESPONSE_ONLY.test(text)
  })
}

type ToolInputSchema = Record<string, unknown>

// Keep this behavior aligned with `normalize_openai_tool_parameters_schema` in Rust.
export function normalizeToolInputSchema(
  schema: ToolInputSchema
): ToolInputSchema {
  return normalizeToolInputSchemaValue(schema) as ToolInputSchema
}

/** Text from the most recent user message (for MCP server routing). */
type ChatTemplateKwargs = Record<string, boolean | number | string>

/**
 * Build the per-request `chat_template_kwargs` for llama-server's chat
 * completions endpoint, merging the reasoning toggle with any user-set
 * per-model template kwargs (e.g. `preserve_thinking`) into one object. The
 * server parses each value via `json_value(...).dump()`
 * (server-common.cpp:1056-1069) and rejects values that serialize to a quoted
 * JSON string where a boolean/number is expected — so this emits real JSON
 * types, never the strings `"true"` / `"false"`. Reasoning 'auto'/undefined
 * omits `enable_thinking` so the server falls back to its --reasoning-budget
 * default; `enable_thinking` from the reasoning control always wins over a
 * user-supplied value. The function is a no-op for non-llamacpp providers.
 */
export function buildLlamacppReasoningParams(
  providerName: string | null | undefined,
  reasoning: 'auto' | 'on' | 'off' | undefined,
  userKwargs?: ChatTemplateKwargs | null
): { chat_template_kwargs?: ChatTemplateKwargs } {
  if (providerName !== 'llamacpp') return {}
  const kwargs: ChatTemplateKwargs = {}
  if (userKwargs && typeof userKwargs === 'object') {
    for (const [key, value] of Object.entries(userKwargs)) {
      if (key === 'enable_thinking') continue
      const t = typeof value
      if (t === 'boolean' || t === 'number' || t === 'string') {
        kwargs[key] = value
      }
    }
  }
  if (reasoning === 'on' || reasoning === 'off') {
    kwargs.enable_thinking = reasoning === 'on'
  }
  if (Object.keys(kwargs).length === 0) return {}
  return { chat_template_kwargs: kwargs }
}

function extractLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const parts = Array.isArray(m.parts) ? m.parts : []
    const chunks: string[] = []
    for (const p of parts) {
      if (p.type === 'text' && typeof (p as { text?: string }).text === 'string') {
        const t = (p as { text: string }).text.trim()
        if (t) chunks.push(t)
      }
    }
    if (chunks.length > 0) return chunks.join('\n')
  }
  return ''
}

/**
 * Wraps a UIMessageChunk stream so the partial content of a resumed turn is
 * injected back into the new message right away: `reasoning` into the first
 * `reasoning-start` block and `text` into the first `text-start` block. This
 * makes the continuation look seamless instead of dropping the partial output.
 */
function prependContinuationToUIStream(
  stream: ReadableStream<UIMessageChunk>,
  prefix: ContinuationContent
): ReadableStream<UIMessageChunk> {
  const reader = stream.getReader()
  let reasoningEmitted = !prefix.reasoning
  let textEmitted = !prefix.text
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
        const type = (value as { type: string }).type
        if (!reasoningEmitted && type === 'reasoning-start') {
          reasoningEmitted = true
          const id = (value as { id: string }).id
          controller.enqueue({
            type: 'reasoning-delta',
            id,
            delta: prefix.reasoning,
          } as UIMessageChunk)
        }
        if (!textEmitted && type === 'text-start') {
          textEmitted = true
          const id = (value as { id: string }).id
          controller.enqueue({
            type: 'text-delta',
            id,
            delta: prefix.text,
          } as UIMessageChunk)
        }
      } catch (error) {
        controller.error(error)
      }
    },
    cancel() {
      reader.cancel()
    },
  })
}

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  private routerModel: LanguageModel | null = null
  private routerModelKey = ''
  private tools: Record<string, Tool> = {}
  // Smart tool routing selects tools from the latest user message, which would
  // change the tool set (and thus the cached prompt prefix) every turn. Freeze
  // the routed set for the thread's lifetime so the prefix stays stable;
  // re-route only when the connected servers or disabled-tool set changes.
  private frozenRoutedTools: MCPTool[] | null = null
  private frozenRoutedSig = ''
  private onTokenUsage?: TokenUsageCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private continueFromContent: ContinuationContent | null = null
  /** Latest user message text — used by the MCP orchestrator for tool routing. */
  private lastUserMessage = ''
  /**
   * Monotonic per-request token. The transport instance is reused across
   * regenerate, so a superseded request's terminal onError/onFinish must not
   * clear loading/stream state that the newer request has already set.
   */
  private streamGeneration = 0

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.serviceHub = useServiceStore.getState().serviceHub
    // Tools will be loaded when updateRagToolsAvailability is called with model capabilities
  }

  setLastUserMessage(message: string): void {
    this.lastUserMessage = message
  }

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  // Inference params follow the thread's assigned assistant so in-chat agent
  // switches take effect immediately. A thread with no real assistant
  // (model-only / "None") uses no assistant params — matching the switcher.
  // Only off-thread (no threadId / thread not yet in store) do we fall back to
  // the global current assistant.
  private getActiveInferenceParams(): Record<string, unknown> {
    const thread = this.threadId
      ? useThreads.getState().threads[this.threadId]
      : undefined
    if (thread) {
      const threadAssistant = thread.assistants?.[0]
      return threadAssistant && threadAssistant.id !== 'model-only'
        ? (threadAssistant.parameters ?? {})
        : {}
    }
    return useAssistant.getState().currentAssistant?.parameters ?? {}
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    this.onTokenUsage = callback
  }

  /**
   * Update RAG tools availability based on thread metadata and model capabilities
   * @param hasDocuments - Whether the thread has documents attached
   * @param modelSupportsTools - Whether the current model supports tool calling
   * @param ragFeatureAvailable - Whether RAG features are available on the platform
   */
  async updateRagToolsAvailability(
    hasDocuments: boolean,
    modelSupportsTools: boolean,
    ragFeatureAvailable: boolean
  ) {
    this.hasDocuments = hasDocuments
    this.modelSupportsTools = modelSupportsTools
    this.ragFeatureAvailable = ragFeatureAvailable

    // Update tools based on current state
    await this.refreshTools()
  }

  /**
   * Refresh tools based on current state
   * Reloads both RAG and MCP tools and merges them
   * Filters out disabled tools based on thread settings
   * @private
   */
  async refreshTools(abortSignal?: AbortSignal) {
    if (!this.serviceHub) {
      this.tools = {}
      return
    }

    const toolsRecord: Record<string, Tool> = {}

    // Tool availability is global (shared across all chats).
    const disabledToolKeys = useToolAvailable.getState().getDisabledTools()
    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

    // Only load tools if model supports them
    if (modelSupportsTools) {
      let hasDocuments = this.hasDocuments
      let ragFeatureAvailable = this.ragFeatureAvailable

      if (!hasDocuments && this.threadId) {
        const thread = useThreads.getState().threads[this.threadId]
        const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)

        const projectId = thread?.metadata?.project?.id
        if (projectId) {
          try {
            const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
              ExtensionTypeEnum.VectorDB
            )
            if (ext?.listAttachmentsForProject) {
              const projectFiles = await ext.listAttachmentsForProject(projectId)
              hasDocuments = hasThreadDocuments || projectFiles.length > 0
            }
          } catch (error) {
            console.warn('Failed to check project files:', error)
            hasDocuments = hasThreadDocuments
          }
        } else {
          hasDocuments = hasThreadDocuments
        }
      }

      if (!ragFeatureAvailable) {
        ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      }

      // Load RAG tools if documents are available
      if (hasDocuments && ragFeatureAvailable) {
        try {
          const ragTools = await this.serviceHub.rag().getTools()
          if (Array.isArray(ragTools) && ragTools.length > 0) {
            // Convert RAG tools to AI SDK format, filtering out disabled tools
            ragTools.forEach((tool) => {
              // RAG tools use MCPTool interface with server field
              const serverName =
                (tool as { server?: string }).server || 'unknown'
              if (!isToolDisabled(serverName, tool.name)) {
                toolsRecord[tool.name] = {
                  description: tool.description,
                  inputSchema: jsonSchema(
                    normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>)
                  ),
                } as Tool
              }
            })
          }
        } catch (error) {
          console.warn('Failed to load RAG tools:', error)
        }
      }

      // Load MCP tools — route through the orchestrator when available so only
      // relevant servers are queried instead of all of them.
      try {
        const mcpService = this.serviceHub.mcp()
        let mcpTools: MCPTool[]
        const mcpSettings = useMCPServers.getState().settings
        const routingEnabled = mcpSettings.enableSmartToolRouting

        if (
          routingEnabled &&
          mcpService.getToolsForServers &&
          mcpService.getServerSummaries
        ) {
          const summaries = await mcpService.getServerSummaries!()
          const routedSig = JSON.stringify({
            servers: summaries.map((s) => s.name).sort(),
            disabled: [...disabledToolKeys].sort(),
          })
          if (this.frozenRoutedTools && this.frozenRoutedSig === routedSig) {
            mcpTools = this.frozenRoutedTools
          } else {
            const routerModel =
              mcpSettings.useLightweightRouterModel &&
              mcpSettings.routerModelProvider.trim() &&
              mcpSettings.routerModelId.trim()
                ? (await this.resolveRouterModel(mcpSettings)) ?? this.model
                : this.model
            mcpTools = await mcpOrchestrator.getRelevantTools(
              this.lastUserMessage,
              {
                getTools: () => mcpService.getTools(),
                getToolsForServers: (names) =>
                  mcpService.getToolsForServers!(names),
                getServerSummaries: () => Promise.resolve(summaries),
              },
              disabledToolKeys,
              {
                routerModel,
                abortSignal,
              }
            )
            this.frozenRoutedTools = mcpTools
            this.frozenRoutedSig = routedSig
          }
        } else {
          mcpTools = await mcpService.getTools()
        }

        if (Array.isArray(mcpTools) && mcpTools.length > 0) {
          const seenBy = new Map<string, string>()
          mcpTools.forEach((tool) => {
            const serverName = tool.server || 'unknown'
            if (isToolDisabled(serverName, tool.name)) return
            const prevServer = seenBy.get(tool.name)
            if (prevServer && prevServer !== serverName) {
              console.warn(
                `[tools] MCP tool name collision: "${tool.name}" exposed by both "${prevServer}" and "${serverName}". Using "${serverName}".`
              )
            }
            seenBy.set(tool.name, serverName)
            toolsRecord[tool.name] = {
              description: tool.description,
              inputSchema: jsonSchema(
                normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>)
              ),
            } as Tool
          })
        }
      } catch (error) {
        console.warn('Failed to load MCP tools:', error)
      }

      // Native web tools, provided by the websearch plugin (not an MCP server).
      // Advertised whenever the user has web search enabled.
      if (useWebSearchConfig.getState().webSearchEnabled) {
        toolsRecord['web_search'] = {
          description: WEB_SEARCH_DESCRIPTION,
          inputSchema: jsonSchema(WEB_SEARCH_INPUT_SCHEMA as Record<string, unknown>),
        } as Tool
        toolsRecord['web_fetch'] = {
          description: WEB_FETCH_DESCRIPTION,
          inputSchema: jsonSchema(WEB_FETCH_INPUT_SCHEMA as Record<string, unknown>),
        } as Tool
      }
    }

    this.tools = toolsRecord
  }

  private async resolveRouterModel(settings: {
    useLightweightRouterModel: boolean
    routerModelProvider: string
    routerModelId: string
  }): Promise<LanguageModel | null> {
    if (!settings.useLightweightRouterModel) return null
    const providerName = settings.routerModelProvider.trim()
    const modelId = settings.routerModelId.trim()
    if (!providerName || !modelId) return null

    const key = `${providerName}::${modelId}`
    if (this.routerModel && this.routerModelKey === key) {
      return this.routerModel
    }

    const provider = useModelProvider.getState().getProviderByName(providerName)
    if (!provider) {
      console.warn(
        `[MCP] Router model provider '${providerName}' not found; using chat model for routing.`
      )
      return null
    }

    const catalogModel = provider.models.find((m) => m.id === modelId)
    if (!catalogModel || !isRouterModelSelectable(provider, catalogModel)) {
      console.warn(
        `[MCP] Router model '${key}' is not allowed for routing (use a lightweight model with API access); using chat model for routing.`
      )
      return null
    }

    try {
      const model = await ModelFactory.createModel(modelId, provider, {})
      this.routerModel = model
      this.routerModelKey = key
      return model
    } catch (error) {
      console.warn(
        `[MCP] Failed to create router model '${key}'; using chat model for routing.`,
        error
      )
      this.routerModel = null
      this.routerModelKey = ''
      return null
    }
  }

  /**
   * Get current tools
   */
  getTools(): Record<string, Tool> {
    return this.tools
  }

  /**
   * Set partial assistant content to send as a prefill on the next request,
   * so the model continues generation from where it left off. Accepts a plain
   * text string, or structured content carrying reasoning so a turn stopped
   * mid-thinking resumes inside its reasoning block.
   */
  setContinueFromContent(content: string | ContinuationContent) {
    const normalized: ContinuationContent =
      typeof content === 'string' ? { text: content } : content
    this.continueFromContent =
      normalized.text || normalized.reasoning ? normalized : null
  }

  /**
   * Race model creation (which blocks on llama-server load, up to 600s)
   * against the request's abort signal. `invoke()` has no cancellation of
   * its own, so an abort during "Loading model..." would otherwise be
   * silently ignored until load either finishes or times out. On abort we
   * fire-and-forget an unload of the (possibly still-loading) model so the
   * router doesn't keep spawning/holding a llama-server nobody wants.
   */
  private createModelOrAbort(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown>,
    providerId: string,
    abortSignal: AbortSignal | undefined
  ): Promise<LanguageModel> {
    const modelPromise = ModelFactory.createModel(modelId, provider, parameters)
    if (!abortSignal) return modelPromise

    // Target lib is ES2021 here (see tsconfig.app.json), predating
    // Promise.withResolvers (ES2024), so the executor form is required.
    return new Promise<LanguageModel>((resolve, reject) => {
      const onAbort = () => {
        if (providerId === 'llamacpp') {
          // Call the plugin's unload command directly instead of through the
          // extension's `unload()` method: that method first looks up an
          // active *loaded* session and throws if none is found, but a
          // model aborted mid-load is still in the "loading" state (not
          // "loaded") and would never resolve to a session -- silently
          // skipping the unload and leaking the still-loading llama-server.
          // See https://github.com/janhq/jan/issues/8432.
          unloadLlamaModel(modelId).catch(() => {
            // Best-effort: model may not have started loading yet, or may
            // already have finished/failed on its own.
          })
        }
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      }
      if (abortSignal.aborted) {
        onAbort()
        return
      }
      abortSignal.addEventListener('abort', onAbort, { once: true })
      modelPromise
        .then((model) => {
          abortSignal.removeEventListener('abort', onAbort)
          resolve(model)
        })
        .catch((error) => {
          abortSignal.removeEventListener('abort', onAbort)
          reject(error)
        })
    })
  }

  async sendMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const threadId = this.threadId ?? options.chatId
    const myGeneration = ++this.streamGeneration
    useAppState.getState().setCurrentStreamThreadId(threadId)
    // Capture the effective provider name early so the Anthropic serial
    // tool-use repair later uses the same value that was used to create the
    // model, even if the user switches provider mid-request.
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const effectiveProviderName = providerId
    const provider = useModelProvider.getState().getProviderByName(providerId)
    if (!this.serviceHub || !modelId || !provider) {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    this.lastUserMessage = extractLatestUserText(options.messages)

    try {
      const updatedProvider = useModelProvider
        .getState()
        .getProviderByName(providerId)

      const inferenceParams = this.getActiveInferenceParams()

      const selectedModel = useModelProvider.getState().selectedModel
      const reasoningParams = buildLlamacppReasoningParams(
        effectiveProviderName,
        selectedModel?.settings?.reasoning?.controller_props?.value as
          | 'auto'
          | 'on'
          | 'off'
          | undefined,
        extractModelTemplateKwargs(selectedModel)
      )

      if (providerId === 'llamacpp') {
        try {
          const loaded = await getLoadedModels()
          if (!loaded.includes(modelId)) {
            useAppState.getState().updateLoadingModel(true)
            useAppState.getState().updateThreadLoadingModel(threadId, true)
            useAppState.getState().updateModelLoadProgress(undefined)
            useAppState.getState().updateThreadModelLoadProgress(threadId, undefined)
          }
        } catch {
          // Ignore probe failures; the router will still load on demand
        }
      }

      // Per-model sidebar sampling defaults flow through as request-body
      // overrides (router mode can't bake them into CLI args). Assistant
      // params still win — they're the explicit per-conversation override.
      const modelSamplingDefaults = extractModelSamplingDefaults(selectedModel)
      if (providerId === 'llamacpp') {
        const thinkingBudgetTokens = await resolveThinkingBudgetTokens(
          selectedModel,
          modelId
        )
        if (thinkingBudgetTokens !== undefined) {
          modelSamplingDefaults.thinking_budget_tokens = thinkingBudgetTokens
        }
      }

      // Create the model before refreshing tools so the MCP orchestrator can run
      // structured LLM routing when many servers are connected.
      const mergedParams: Record<string, unknown> = {
        ...modelSamplingDefaults,
        ...(inferenceParams ?? {}),
        ...reasoningParams,
      }
      if (isPredefinedRemoteProvider(effectiveProviderName)) {
        for (const key of Object.keys(paramsSettings)) delete mergedParams[key]
      }
      // Pin chat to slot 0 so llama-server reuses this thread's cached KV
      // prefix across turns; title generation uses the reserved background
      // slot (RESERVED_BACKGROUND_SLOTS) and can't evict it.
      if (providerId === 'llamacpp') {
        mergedParams.id_slot = 0
      }
      this.model = await this.createModelOrAbort(
        modelId,
        updatedProvider ?? provider,
        mergedParams,
        providerId,
        options.abortSignal
      )
      useAppState.getState().updateLoadingModel(false)
      useAppState.getState().updateThreadLoadingModel(threadId, false)
      useAppState.getState().updateModelLoadProgress(undefined)
      useAppState.getState().updateThreadModelLoadProgress(threadId, undefined)
    } catch (error) {
      useAppState.getState().updateLoadingModel(false)
      useAppState.getState().updateThreadLoadingModel(threadId, false)
      useAppState.getState().updateModelLoadProgress(undefined)
      useAppState.getState().updateThreadModelLoadProgress(threadId, undefined)
      console.error('Failed to create model:', error)
      // Preserve AbortError identity so callers/UI can tell a user-initiated
      // Stop from an actual model-load failure.
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error(
        `Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
      )
    }

    await this.refreshTools(options.abortSignal)

    // Split assistant turns that place text after tool calls into separate
    // messages. Required by the Claude API (tool_use / tool_result pairing) and
    // it keeps the prompt prefix byte-identical across turns so llama.cpp reuses
    // the KV cache. See `splitAssistantToolWaves`.
    const messagesToConvert = splitAssistantToolWaves(options.messages)

    const inferenceParams = this.getActiveInferenceParams()

    const selectedModel = useModelProvider.getState().selectedModel

    const filesInstruction = this.buildFilesSystemInstruction(messagesToConvert)
    const webSearchInstruction = this.buildWebSearchSystemInstruction()
    const rawSystem =
      [this.systemMessage, filesInstruction, webSearchInstruction]
        .filter((s) => typeof s === 'string' && s.trim().length > 0)
        .join('\n\n') || undefined
    // Drop whitespace-only system prompts so we don't send a useless system
    // turn that some chat templates still wrap into special tokens.
    const effectiveSystem =
      typeof rawSystem === 'string' && rawSystem.trim().length > 0
        ? rawSystem
        : undefined

    const maxOutputTokens: number | undefined = (() => {
      const raw = inferenceParams.max_output_tokens ?? inferenceParams.max_tokens
      if (raw === undefined || raw === null) return undefined
      const n = typeof raw === 'number' ? raw : Number(raw)
      return isNaN(n) ? undefined : n
    })()

    const maxContextTokens = (() => {
      const raw = inferenceParams.max_context_tokens
      return typeof raw === 'number' ? raw : (Number(raw) || 0)
    })()
    const autoCompact =
      inferenceParams.auto_compact === true ||
      inferenceParams.auto_compact === 'true'

    // Auto-trim or auto-compact conversation history when max_context_tokens is configured
    let effectiveMessages = messagesToConvert
    if (maxContextTokens > 0) {
      const contextConfig: ContextManagerConfig = {
        maxContextTokens,
        maxOutputTokens: maxOutputTokens ?? 2048,
        autoCompact: !!autoCompact,
      }

      const systemPromptTokens = effectiveSystem
        ? estimateTokens(effectiveSystem) + 4
        : 0

      if (autoCompact && this.model) {
        const compactResult = await compactMessages(
          messagesToConvert,
          contextConfig,
          this.model,
          systemPromptTokens
        )
        effectiveMessages = compactResult.messages
        if (compactResult.trimmedCount > 0) {
          console.debug(
            `[context-manager] Compacted ${compactResult.trimmedCount} messages` +
              (compactResult.compactedSummary ? ' with summary' : ' (trim fallback)')
          )
        }
      } else {
        const trimResult = trimMessages(
          messagesToConvert,
          contextConfig,
          systemPromptTokens
        )
        effectiveMessages = trimResult.messages
        if (trimResult.trimmedCount > 0) {
          console.debug(
            `[context-manager] Trimmed ${trimResult.trimmedCount} oldest messages to fit context budget`
          )
        }
      }
    }

    // Many chat templates (Qwen3.5+) reject a window with no genuine user query
    // and throw a cryptic Jinja error. Fail early with a clear message when
    // deletion/eviction has left no real user turn to respond to.
    if (!hasGenuineUserQuery(effectiveMessages)) {
      throw new Error(
        'This conversation has no user message to respond to. Add a message, or regenerate from a turn that includes your question.'
      )
    }

    const modelSupportsVision =
      selectedModel?.capabilities?.includes('vision') ?? false
    const baseMessages = await convertToModelMessages(
      coalesceMessagesForAlternation(
        resolveOrphanToolCalls(
          this.encodeVideoAttachments(
            this.encodeAudioAttachments(
              stripUnsupportedImageParts(
                this.mapUserInlineAttachments(effectiveMessages),
                modelSupportsVision
              )
            )
          )
        )
      )
    )

    // If continuing a truncated response, append the partial assistant content as a
    // prefill so the model resumes from where it left off rather than regenerating.
    const continueContent = this.continueFromContent
    this.continueFromContent = null
    const modelMessages = continueContent
      ? [
          ...baseMessages,
          {
            role: 'assistant' as const,
            content: [
              ...(continueContent.reasoning
                ? [
                    {
                      type: 'reasoning' as const,
                      text: continueContent.reasoning,
                    },
                  ]
                : []),
              ...(continueContent.text
                ? [{ type: 'text' as const, text: continueContent.text }]
                : []),
            ],
          },
        ]
      : baseMessages

    // Include tools only if we have tools loaded AND model supports them
    const hasTools = Object.keys(this.tools).length > 0
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools
    const shouldEnableTools = hasTools && modelSupportsTools

    // Cloud providers take reasoning via the AI SDK's per-request
    // providerOptions (native thinking config), not the raw body.
    const reasoningProviderOptions = buildReasoningProviderOptions(
      providerId,
      useModelProvider.getState().selectedModel
    )

    let streamStartTime: number | undefined
    useAppState.getState().updatePromptProgress(undefined)
    useAppState.getState().updateThreadPromptProgress(threadId, undefined)
    useAppState.getState().updateLiveTokenStats(undefined)
    useAppState.getState().updateThreadLiveTokenStats(threadId, undefined)

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: effectiveSystem,
      ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
      ...(reasoningProviderOptions
        ? { providerOptions: reasoningProviderOptions }
        : {}),
      experimental_repairToolCall: async ({ toolCall, error }) => {
        // Windows paths (`C:\Users\...`) contain invalid JSON escapes that make
        // the SDK's argument parse fail. Re-escape lone backslashes and retry
        // so the tool receives the intended path instead of looping on failure.
        if (!InvalidToolInputError.isInstance(error)) return null
        const repaired = repairToolArgs(toolCall.input)
        if (!repaired) return null
        return { ...toolCall, input: JSON.stringify(repaired) }
      },
    })

    let tokensPerSecond = 0
    let promptPerSecond = 0

    const uiStream = result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        if (
          !streamStartTime &&
          (part.type === 'text-start' || part.type === 'reasoning-start')
        ) {
          streamStartTime = Date.now()
        }

        if (part.type === 'finish-step') {
          tokensPerSecond =
            (part.providerMetadata?.providerMetadata
              ?.tokensPerSecond as number) || 0
          promptPerSecond =
            (part.providerMetadata?.providerMetadata
              ?.promptPerSecond as number) || 0
        }

        // Add usage and token speed to metadata on finish
        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
          }
          const usage = finishPart.totalUsage
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          // Use provider's outputTokens, or llama.cpp completionTokens, or fall back to text delta count
          const outputTokens = usage?.outputTokens ?? 0
          const inputTokens = usage?.inputTokens

          // Use llama.cpp's tokens per second if available, otherwise calculate from duration
          let tokenSpeed: number
          if (durationSec > 0 && outputTokens > 0) {
            tokenSpeed =
              tokensPerSecond > 0 ? tokensPerSecond : outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          return {
            finishReason: finishPart.finishReason,
            usage: {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              totalTokens:
                usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            },
            tokenSpeed: {
              tokenSpeed: Math.round(tokenSpeed * 100) / 100,
              promptSpeed: promptPerSecond
                ? Math.round(promptPerSecond * 100) / 100
                : undefined,
              tokenCount: outputTokens,
              durationMs,
            },
          }
        }

        return undefined
      },
      onError: (error) => {
        // A superseded request (e.g. after Reload) must not clear loading/stream
        // state the newer request already owns.
        if (this.streamGeneration === myGeneration) {
          useAppState.getState().updatePromptProgress(undefined)
          useAppState.getState().updateLoadingModel(false)
          useAppState.getState().updateThreadPromptProgress(threadId, undefined)
          useAppState.getState().updateThreadLoadingModel(threadId, false)
          useAppState.getState().updateLiveTokenStats(undefined)
          useAppState.getState().updateThreadLiveTokenStats(threadId, undefined)
          if (useAppState.getState().currentStreamThreadId === threadId) {
            useAppState.getState().setCurrentStreamThreadId(undefined)
          }
        }
        const unwrapped = unwrapRetryError(error)
        const rawMessage = unwrapped == null
          ? 'Unknown error'
          : typeof unwrapped === 'string'
            ? unwrapped
            : unwrapped instanceof Error
              ? unwrapped.message
              : JSON.stringify(unwrapped)
        const baseMessage = stripRetryErrorWrapper(rawMessage)

        const contextInfo = extractContextInfoFromError(unwrapped)
        if (contextInfo) {
          return `${baseMessage}\n\n(Used ${contextInfo.nPromptTokens.toLocaleString()} of ${contextInfo.nCtx.toLocaleString()} context tokens.)`
        }
        return baseMessage
      },
      onFinish: ({ responseMessage }) => {
        if (this.streamGeneration === myGeneration) {
          useAppState.getState().updatePromptProgress(undefined)
          useAppState.getState().updateLoadingModel(false)
          useAppState.getState().updateThreadPromptProgress(threadId, undefined)
          useAppState.getState().updateThreadLoadingModel(threadId, false)
          useAppState.getState().updateLiveTokenStats(undefined)
          useAppState.getState().updateThreadLiveTokenStats(threadId, undefined)
          if (useAppState.getState().currentStreamThreadId === threadId) {
            useAppState.getState().setCurrentStreamThreadId(undefined)
          }
        }
        if (responseMessage) {
          const metadata = responseMessage.metadata as
            | Record<string, unknown>
            | undefined
          const usage = metadata?.usage as LanguageModelUsage | undefined
          if (usage) {
            this.onTokenUsage?.(usage, responseMessage.id)
          }
        }
      },
    })

    // When continuing a truncated response, inject the partial content as the
    // very first text-delta so the new message immediately shows it and the
    // user sees a seamless continuation rather than an empty box.
    const finalStream = continueContent
      ? prependContinuationToUIStream(uiStream, continueContent)
      : uiStream

    return finalStream
  }

  async reconnectToStream(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: {
      chatId: string
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // This function normally handles reconnecting to a stream on the backend, e.g. /api/chat
    // Since this project has no backend, we can't reconnect to a stream, so this is intentionally no-op.
    return null
  }

  // Replace audio `file` parts on user messages with sentinel-bearing `text`
  // parts. The `@ai-sdk/openai-compatible` provider rejects non-image file
  // parts in its converter; the matching fetch wrapper in model-factory.ts
  // decodes these sentinels back into OpenAI `input_audio` content parts on
  // the outgoing wire, which llama-server's chat-completions endpoint accepts.
  encodeAudioAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role !== 'user' || !Array.isArray(message.parts)) return message
      let touched = false
      const nextParts = message.parts.map((part) => {
        if (
          part?.type === 'file' &&
          typeof (part as { mediaType?: string }).mediaType === 'string' &&
          (part as { mediaType: string }).mediaType.startsWith('audio/') &&
          typeof (part as { url?: string }).url === 'string'
        ) {
          const parsed = parseAudioDataUrl((part as { url: string }).url)
          if (!parsed) return part
          touched = true
          return { type: 'text' as const, text: encodeAudioSentinel(parsed.format, parsed.data) }
        }
        return part
      })
      if (!touched) return message
      return { ...message, parts: nextParts } as UIMessage
    })
  }

  // Replace video `file` parts on user messages with sentinel-bearing `text`
  // parts, same mechanism as encodeAudioAttachments. The fetch wrapper in
  // model-factory.ts decodes these into llama-server `input_video` content
  // parts (frames decoded via the vision encoder + ffmpeg on the server).
  encodeVideoAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role !== 'user' || !Array.isArray(message.parts)) return message
      let touched = false
      const nextParts = message.parts.map((part) => {
        if (
          part?.type === 'file' &&
          typeof (part as { mediaType?: string }).mediaType === 'string' &&
          (part as { mediaType: string }).mediaType.startsWith('video/') &&
          typeof (part as { url?: string }).url === 'string'
        ) {
          const parsed = parseVideoDataUrl((part as { url: string }).url)
          if (!parsed) return part
          touched = true
          return { type: 'text' as const, text: encodeVideoSentinel(parsed.data) }
        }
        return part
      })
      if (!touched) return message
      return { ...message, parts: nextParts } as UIMessage
    })
  }

  /**
   * [ATTACHED_FILES] blocks stay on the user message that carries them (see
   * fileMetadata.ts injectFilesIntoPrompt) so the model reads file_ids in the
   * turn they belong to. Only a static, file-independent instruction is added
   * to the system prompt - it never varies per attachment, so it doesn't
   * defeat prompt caching.
   */
  buildFilesSystemInstruction(messages: UIMessage[]): string {
    const hasAttachedFiles = messages.some(
      (message) =>
        message.role === 'user' &&
        Array.isArray(message.parts) &&
        message.parts.some(
          (part) =>
            part?.type === 'text' &&
            typeof (part as { text?: string }).text === 'string' &&
            (part as { text: string }).text.includes('[ATTACHED_FILES]')
        )
    )
    if (!hasAttachedFiles) return ''
    return [
      'Some user messages contain an [ATTACHED_FILES] block listing files',
      'attached to that turn (file_id, name, type, size, chunk count, mode).',
      'Use the available retrieval tools with those file_ids when their',
      'contents are relevant to the request.',
    ].join(' ')
  }

  /**
   * Static instruction teaching the model to use the native web tools and cite
   * sources inline with [[cite:URL]] markers (rendered as favicon chips). Only
   * added when web search is enabled so it doesn't affect prompt caching for
   * users who keep it off.
   */
  buildWebSearchSystemInstruction(): string {
    if (!useWebSearchConfig.getState().webSearchEnabled) return ''
    return [
      '# Web Access',
      'You can search the web with web_search and read pages with web_fetch.',
      'Use them whenever the request needs current, external, or verifiable',
      'information, then base your answer on what you find. When a statement',
      'relies on a web source, cite it inline immediately after that statement',
      'using the exact marker [[cite:URL]], where URL is the full source URL',
      'from a web_search result (for example: [[cite:https://example.com/page]]).',
      'Cite each distinct source you rely on; do not add a separate references',
      'or sources section.',
    ].join(' ')
  }

  mapUserInlineAttachments(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        const metadata = message.metadata as
          | {
              inline_file_contents?: Array<{ name?: string; content?: string }>
            }
          | undefined
        const inlineFileContents = Array.isArray(metadata?.inline_file_contents)
          ? metadata.inline_file_contents.filter((f) => f?.content)
          : []
        // Tool messages have content as array of ToolResultPart
        if (inlineFileContents.length > 0) {
          const buildInlineText = (base: string) => {
            if (!inlineFileContents.length) return base
            const formatted = inlineFileContents
              .map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`)
              .join('\n\n')
            return base ? `${base}\n\n${formatted}` : formatted
          }

          if (message.parts.length > 0) {
            const parts = message.parts.map((part) => {
              if (part.type === 'text') {
                return {
                  type: 'text' as const,
                  text: buildInlineText(part.text ?? ''),
                }
              }
              return part
            })
            message.parts = parts
          }
        }
      }

      return message
    })
  }
}
