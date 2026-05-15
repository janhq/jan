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
import { invoke } from '@tauri-apps/api/core'
import { ExtensionManager } from '@/lib/extension'
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
import { extractFilesFromPrompt, type FileMetadata } from '@/lib/fileMetadata'

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

function normalizeToolInputSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolInputSchemaValue)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
      key,
      normalizeToolInputSchemaValue(childValue),
    ])
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

  return normalized
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
 * Wraps a UIMessageChunk stream so that when the first `text-start` chunk
 * arrives, a `text-delta` carrying `prefixText` is immediately injected into
 * the same text block. This makes the new message show the partial content
 * right away while continuation tokens stream in after it.
 */
function prependTextDeltaToUIStream(
  stream: ReadableStream<UIMessageChunk>,
  prefixText: string
): ReadableStream<UIMessageChunk> {
  const reader = stream.getReader()
  let prefixEmitted = false
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
        if (!prefixEmitted && (value as { type: string }).type === 'text-start') {
          prefixEmitted = true
          const id = (value as { type: 'text-start'; id: string }).id
          controller.enqueue({ type: 'text-delta', id, delta: prefixText } as UIMessageChunk)
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

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
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
                normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>)
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

      const currentAssistant = useAssistant.getState().currentAssistant
      const inferenceParams = currentAssistant?.parameters

      const selectedModel = useModelProvider.getState().selectedModel
      const reasoningParams = buildLlamacppReasoningParams(
        effectiveProviderName,
        selectedModel?.settings?.reasoning?.controller_props?.value as
          | 'auto'
          | 'on'
          | 'off'
          | undefined
      )

      if (providerId === 'llamacpp') {
        try {
          const loaded = await invoke<string[]>(
            'plugin:llamacpp|get_loaded_models'
          )
          if (!loaded.includes(modelId)) {
            useAppState.getState().updateLoadingModel(true)
            useAppState.getState().updateThreadLoadingModel(threadId, true)
          }
        } catch {
          // Ignore probe failures; the router will still load on demand
        }
      }

      // Create the model before refreshing tools so the MCP orchestrator can run
      // structured LLM routing when many servers are connected.
      this.model = await ModelFactory.createModel(
        modelId,
        updatedProvider ?? provider,
        { ...(inferenceParams ?? {}), ...reasoningParams }
      )
      useAppState.getState().updateLoadingModel(false)
      useAppState.getState().updateThreadLoadingModel(threadId, false)
    } catch (error) {
      useAppState.getState().updateLoadingModel(false)
      useAppState.getState().updateThreadLoadingModel(threadId, false)
      console.error('Failed to create model:', error)
      throw new Error(
        `Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
      )
    }

    await this.refreshTools(options.abortSignal)

    // Fix for Anthropic serial tool-use (error 400): when an assistant message
    // contains tool parts interleaved with text parts (serial tool calls),
    // split it into separate messages so convertToModelMessages produces the
    // tool_use / tool_result pairing that the Claude API requires.
    // See: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#parallel-tool-use
    let messagesToConvert = (() => {
      if (effectiveProviderName !== 'anthropic') {
        return options.messages
      }
      return options.messages.flatMap((message) => {
        if (message.role !== 'assistant') return [message]

        const parts = Array.isArray(message.parts) ? message.parts : []
        if (parts.length === 0) return [message]

        const isToolPart = (p: (typeof parts)[number]) =>
          p.type.startsWith('tool-')

        const waves: (typeof parts)[] = []
        let currentWave: typeof parts = []
        let seenToolParts = false

        for (const part of parts) {
          if (isToolPart(part)) {
            seenToolParts = true
            currentWave.push(part)
          } else if (!isToolPart(part) && seenToolParts) {
            // Any non-tool part (text, reasoning, file, etc.) after tool parts
            // marks the start of a new wave
            waves.push(currentWave)
            currentWave = [part]
            seenToolParts = false
          } else {
            currentWave.push(part)
          }
        }
        if (currentWave.length > 0) waves.push(currentWave)

        // No serial tool calls detected — return original message unchanged
        if (waves.length <= 1) return [message]

        return waves.map((waveParts, i) => ({
          ...message,
          id: `${message.id}_w${i}`,
          parts: waveParts,
        }))
      })
    })()

    const inferenceParams = useAssistant.getState().currentAssistant?.parameters ?? {}

    const selectedModel = useModelProvider.getState().selectedModel

    const { messages: strippedMessages, files: attachedFiles } =
      this.extractFileMetadataForSystem(messagesToConvert)
    messagesToConvert = strippedMessages
    const filesAddendum = this.buildFilesSystemAddendum(attachedFiles)
    const effectiveSystem = filesAddendum
      ? this.systemMessage
        ? `${this.systemMessage}\n\n${filesAddendum}`
        : filesAddendum
      : this.systemMessage

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

    const baseMessages = await convertToModelMessages(
      this.encodeAudioAttachments(this.mapUserInlineAttachments(effectiveMessages))
    )

    // If continuing a truncated response, append the partial assistant content as a
    // prefill so the model resumes from where it left off rather than regenerating.
    const continueContent = this.continueFromContent
    this.continueFromContent = null
    const modelMessages = continueContent
      ? [...baseMessages, { role: 'assistant' as const, content: continueContent }]
      : baseMessages

    // Include tools only if we have tools loaded AND model supports them
    const hasTools = Object.keys(this.tools).length > 0
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools
    const shouldEnableTools = hasTools && modelSupportsTools

    let streamStartTime: number | undefined
    useAppState.getState().updatePromptProgress(undefined)
    useAppState.getState().updateThreadPromptProgress(threadId, undefined)

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: effectiveSystem,
      ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
    })

    let tokensPerSecond = 0

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
              tokenSpeed: Math.round(tokenSpeed * 10) / 10, // Round to 1 decimal
              tokenCount: outputTokens,
              durationMs,
            },
          }
        }

        return undefined
      },
      onError: (error) => {
        useAppState.getState().updatePromptProgress(undefined)
        useAppState.getState().updateLoadingModel(false)
        useAppState.getState().updateThreadPromptProgress(threadId, undefined)
        useAppState.getState().updateThreadLoadingModel(threadId, false)
        if (useAppState.getState().currentStreamThreadId === threadId) {
          useAppState.getState().setCurrentStreamThreadId(undefined)
        }
        const errorMessage = error == null
          ? 'Unknown error'
          : typeof error === 'string'
            ? error
            : error instanceof Error
              ? error.message
              : JSON.stringify(error)

        return errorMessage
      },
      onFinish: ({ responseMessage }) => {
        useAppState.getState().updatePromptProgress(undefined)
        useAppState.getState().updateLoadingModel(false)
        useAppState.getState().updateThreadPromptProgress(threadId, undefined)
        useAppState.getState().updateThreadLoadingModel(threadId, false)
        if (useAppState.getState().currentStreamThreadId === threadId) {
          useAppState.getState().setCurrentStreamThreadId(undefined)
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
      ? prependTextDeltaToUIStream(uiStream, continueContent)
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
  extractFileMetadataForSystem(
    messages: UIMessage[]
  ): { messages: UIMessage[]; files: FileMetadata[] } {
    const byId = new Map<string, FileMetadata>()
    const next = messages.map((message) => {
      if (message.role !== 'user' || !Array.isArray(message.parts)) return message
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
      if (typeof f.chunkCount === 'number') parts.push(`chunks: ${f.chunkCount}`)
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
