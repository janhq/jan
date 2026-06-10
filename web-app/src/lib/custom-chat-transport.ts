import { type UIMessage } from '@ai-sdk/react'
import {
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  type LanguageModelUsage,
  jsonSchema,
} from 'ai'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { useAttachments } from '@/hooks/useAttachments'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useAppState } from '@/hooks/useAppState'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, VectorDBExtension, type MCPTool } from '@janhq/core'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator'
import { isRouterModelSelectable } from '@/lib/mcp-router-model-filter'
import { encodeAudioSentinel, parseAudioDataUrl } from '@/lib/audio-sentinel'
import { extractFilesFromPrompt, type FileMetadata } from '@/lib/fileMetadata'
import {
  sendCodexAppServerChatMessage,
  shutdownCodexAppServerChatSession,
} from '@/lib/codex-app-server'

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

const SCHEMA_NODE_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  'definitions',
  '$defs',
])
const SCHEMA_NODE_LIST_KEYS = new Set([
  'anyOf',
  'oneOf',
  'allOf',
  'prefixItems',
])

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
    Object.entries(value as Record<string, unknown>).map(
      ([key, childValue]) => {
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
          if (Array.isArray(childValue))
            return [key, childValue.map(coerceSchemaNode)]
          return [key, coerceSchemaNode(childValue)]
        }
        return [key, normalizeToolInputSchemaValue(childValue)]
      }
    )
  )

  const hasDescription = Object.prototype.hasOwnProperty.call(
    normalized,
    'description'
  )
  const hasType = Object.prototype.hasOwnProperty.call(normalized, 'type')
  const hasNestedSchemaKeywords =
    Object.prototype.hasOwnProperty.call(normalized, 'properties') ||
    Object.prototype.hasOwnProperty.call(normalized, 'items') ||
    Object.prototype.hasOwnProperty.call(normalized, 'anyOf') ||
    Object.prototype.hasOwnProperty.call(normalized, 'oneOf') ||
    Object.prototype.hasOwnProperty.call(normalized, 'allOf') ||
    Object.prototype.hasOwnProperty.call(normalized, '$ref')

  if (
    normalized.type === 'object' &&
    !Object.prototype.hasOwnProperty.call(normalized, 'properties')
  ) {
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
    if (typeof nPromptTokens !== 'number' || typeof nCtx !== 'number')
      return null
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
const RETRY_NONRETRYABLE_RE =
  /^Failed after \d+ attempts with non-retryable error: '(.+)'$/s

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

type ToolInputSchema = Record<string, unknown>

// Keep this behavior aligned with `normalize_openai_tool_parameters_schema` in Rust.
export function normalizeToolInputSchema(
  schema: ToolInputSchema
): ToolInputSchema {
  return normalizeToolInputSchemaValue(schema) as ToolInputSchema
}

/** Text from the most recent user message (for MCP server routing). */
/**
 * Build the per-request reasoning kwargs for llama-server's chat completions
 * endpoint. The server parses `chat_template_kwargs.enable_thinking` via
 * `json_value(...).dump()` (server-common.cpp:1056-1069) and rejects values
 * that serialize to a quoted JSON string — so this must emit a JSON boolean
 * (`true` / `false`), never the strings `"true"` / `"false"`. 'auto' omits
 * the kwarg entirely so the server falls back to its --reasoning-budget
 * default. The function is a no-op for non-llamacpp providers.
 */
export function buildLlamacppReasoningParams(
  providerName: string | null | undefined,
  reasoning: 'auto' | 'on' | 'off' | undefined
): { chat_template_kwargs?: { enable_thinking: boolean } } {
  if (providerName !== 'llamacpp') return {}
  if (reasoning !== 'on' && reasoning !== 'off') return {}
  return {
    chat_template_kwargs: { enable_thinking: reasoning === 'on' },
  }
}

function extractLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const parts = Array.isArray(m.parts) ? m.parts : []
    const chunks: string[] = []
    for (const p of parts) {
      if (
        p.type === 'text' &&
        typeof (p as { text?: string }).text === 'string'
      ) {
        const t = (p as { text: string }).text.trim()
        if (t) chunks.push(t)
      }
    }
    if (chunks.length > 0) return chunks.join('\n')
  }
  return ''
}

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  private routerModel: LanguageModel | null = null
  private routerModelKey = ''
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private continueFromContent: string | null = null
  /** Latest user message text — used by the MCP orchestrator for tool routing. */
  private lastUserMessage = ''

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.serviceHub = useServiceStore.getState().serviceHub
    // Tools will be loaded when updateRagToolsAvailability is called with model capabilities
  }

  setLastUserMessage(message: string): void {
    this.lastUserMessage = message
  }

  async shutdown(): Promise<void> {
    if (this.threadId) {
      await shutdownCodexAppServerChatSession(this.threadId)
    }
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

    // Get disabled tools for this thread
    const getDisabledToolsForThread =
      useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()
    // Helper to check if a tool is disabled
    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools =
      selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

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
              const projectFiles =
                await ext.listAttachmentsForProject(projectId)
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
                    normalizeToolInputSchema(
                      tool.inputSchema as Record<string, unknown>
                    )
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
          const routerModel =
            mcpSettings.useLightweightRouterModel &&
            mcpSettings.routerModelProvider.trim() &&
            mcpSettings.routerModelId.trim()
              ? ((await this.resolveRouterModel(mcpSettings)) ?? this.model)
              : this.model
          mcpTools = await mcpOrchestrator.getRelevantTools(
            this.lastUserMessage,
            {
              getTools: () => mcpService.getTools(),
              getToolsForServers: (names) =>
                mcpService.getToolsForServers!(names),
              getServerSummaries: () => mcpService.getServerSummaries!(),
            },
            disabledToolKeys,
            {
              routerModel,
              abortSignal,
            }
          )
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
                normalizeToolInputSchema(
                  tool.inputSchema as Record<string, unknown>
                )
              ),
            } as Tool
          })
        }
      } catch (error) {
        console.warn('Failed to load MCP tools:', error)
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
   * so the model continues generation from where it left off.
   */
  setContinueFromContent(content: string) {
    this.continueFromContent = content
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
    useAppState.getState().setCurrentStreamThreadId(threadId)
    const providerId = useModelProvider.getState().selectedProvider
    const provider = useModelProvider.getState().getProviderByName(providerId)
    const selectedModel = useModelProvider.getState().selectedModel

    // Single runtime path: every selected model/provider is executed by Codex.
    // Jan only chooses the target provider/model and renders Codex events.
    if (!providerId || !provider || !selectedModel) {
      throw new Error('A selected model/provider is required to start Codex.')
    }

    this.lastUserMessage = extractLatestUserText(options.messages)
    return sendCodexAppServerChatMessage({
      threadId,
      messageId: options.messageId,
      messages: options.messages,
      provider,
      model: selectedModel,
      abortSignal: options.abortSignal,
    })
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
      if (message.role !== 'user' || !Array.isArray(message.parts))
        return message
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
          return {
            type: 'text' as const,
            text: encodeAudioSentinel(parsed.format, parsed.data),
          }
        }
        return part
      })
      if (!touched) return message
      return { ...message, parts: nextParts } as UIMessage
    })
  }

  /**
   *  Map user messages to include inline attachments in the message parts
   * @param messages
   * @returns
   */
  /**
   * Strip persisted [ATTACHED_FILES] blocks from user message text and return
   * the aggregated, deduped file metadata so it can be folded into the system
   * prompt instead of the user turn. The stored ThreadMessages are untouched
   * (UI still relies on the inline block for display); this only affects what
   * is sent to the model.
   */
  extractFileMetadataForSystem(messages: UIMessage[]): {
    messages: UIMessage[]
    files: FileMetadata[]
  } {
    const byId = new Map<string, FileMetadata>()
    const next = messages.map((message) => {
      if (message.role !== 'user' || !Array.isArray(message.parts))
        return message
      let touched = false
      const parts = message.parts.map((part) => {
        if (
          part?.type === 'text' &&
          typeof (part as { text?: string }).text === 'string' &&
          (part as { text: string }).text.includes('[ATTACHED_FILES]')
        ) {
          const { files, cleanPrompt } = extractFilesFromPrompt(
            (part as { text: string }).text
          )
          if (files.length === 0) return part
          for (const f of files) {
            if (!byId.has(f.id)) byId.set(f.id, f)
          }
          touched = true
          return { ...part, text: cleanPrompt }
        }
        return part
      })
      if (!touched) return message
      return { ...message, parts } as UIMessage
    })
    return { messages: next, files: Array.from(byId.values()) }
  }

  /**
   * Format collected file metadata as a system-prompt addendum. The block is
   * stable / parseable so models can reference file_ids when invoking RAG tools.
   */
  buildFilesSystemAddendum(files: FileMetadata[]): string {
    if (files.length === 0) return ''
    const lines = files.map((f) => {
      const parts = [`file_id: ${f.id}`, `name: ${f.name}`]
      if (f.type) parts.push(`type: ${f.type}`)
      if (typeof f.size === 'number') parts.push(`size: ${f.size}`)
      if (typeof f.chunkCount === 'number')
        parts.push(`chunks: ${f.chunkCount}`)
      if (f.injectionMode) parts.push(`mode: ${f.injectionMode}`)
      return `- ${parts.join(', ')}`
    })
    return [
      'The user has attached the following files to this conversation.',
      'Use the available retrieval tools with these file_ids when their contents are relevant.',
      '[ATTACHED_FILES]',
      ...lines,
      '[/ATTACHED_FILES]',
    ].join('\n')
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
