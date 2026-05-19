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
  type TextStreamPart,
  jsonSchema,
} from 'ai'

/// Hugging Face special-token convention (`<|im_end|>`, `<|eot_id|>`,
/// `<|endoftext|>`, etc.). Some MLX backends — most visibly the DFlash
/// custom `stream_generate` path — leak the EOS marker as plain text in
/// the final delta instead of using it purely as a stop signal. These
/// markers never appear in well-formed assistant output, so we strip
/// them unconditionally before the chunk reaches the UI or the saved
/// message body.
const SPECIAL_TOKEN_REGEX = /<\|[a-zA-Z0-9_]+\|>/g

/// `streamText` transform that scrubs the special-token markers from
/// every `text-delta`. We pass `unknown` for `TOOLS` because the
/// transform doesn't introspect tools.
const stripSpecialTokensTransform = () =>
  new TransformStream<TextStreamPart<never>, TextStreamPart<never>>({
    transform(chunk, controller) {
      if (chunk.type === 'text-delta') {
        const cleaned = chunk.text.replace(SPECIAL_TOKEN_REGEX, '')
        if (cleaned.length === 0) {
          /// Emit a whitespace delta so the UI shows streaming state while
          /// reasoning / special-token-only prefixes are stripped.
          controller.enqueue({ ...chunk, text: ' ' })
          return
        }
        controller.enqueue({ ...chunk, text: cleaned })
        return
      }
      controller.enqueue(chunk)
    },
  })
import { useServiceStore } from '@/hooks/useServiceHub'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useThreads } from '@/hooks/useThreads'
import { useAttachments } from '@/hooks/useAttachments'
import { useAppState } from '@/hooks/useAppState'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { ttftMark } from '@/lib/ttft-timing'
import { renderInstructions } from '@/lib/instructionTemplate'

/// Local inference backends for which we apply the "thinking-off ergonomics":
/// when the user toggles reasoning off we strip the assistant system prompt
/// down to a minimal identity stub AND drop tools entirely. Rationale:
/// gemma-4 (and similar local models) reliably auto-emit a chain-of-thought
/// block whenever the rendered prompt contains BOTH a system message and
/// tools, even with `chat_template_kwargs.enable_thinking=false`. Without
/// the strip, TTFT regresses and the model dumps CoT into either
/// `delta.reasoning` (hidden by the UI -> long blank screen) or worse,
/// straight into `delta.content`.
const LOCAL_PROVIDERS_FOR_REASONING_STRIP = new Set<string>([
  'mlx',
  'llamacpp',
  'llamacpp-upstream',
  'foundation-models',
])

/// Minimal system prompt used when the assistant + tools strip is active.
/// Keeps Atomic Chat's identity and the current date, drops all CoT /
/// tool-calling instructions that would otherwise re-trigger the chain-
/// of-thought heuristic on local models.
const MINIMAL_SYSTEM_PROMPT_TEMPLATE =
  'You are Atomic Chat, a helpful assistant. Current date: {{current_date}}.'

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
export type OnToolCallCallback = (params: {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}) => void
export type ServiceHub = {
  rag(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
  mcp(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
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
        if (
          !prefixEmitted &&
          (value as { type: string }).type === 'text-start'
        ) {
          prefixEmitted = true
          const id = (value as { type: 'text-start'; id: string }).id
          controller.enqueue({
            type: 'text-delta',
            id,
            delta: prefixText,
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
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private continueFromContent: string | null = null
  private toolsCacheKey = ''
  private toolsCacheValid = false

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.serviceHub = useServiceStore.getState().serviceHub
    // Tools will be loaded when updateRagToolsAvailability is called with model capabilities
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
  invalidateToolsCache() {
    this.toolsCacheValid = false
  }

  private buildToolsCacheKey(
    disabledToolKeys: string[],
    hasDocuments: boolean,
    ragFeatureAvailable: boolean,
    modelSupportsTools: boolean
  ): string {
    const mcp = [...useAppState.getState().mcpToolNames].sort().join(',')
    const rag = [...useAppState.getState().ragToolNames].sort().join(',')
    return [
      this.threadId ?? '',
      hasDocuments,
      ragFeatureAvailable,
      modelSupportsTools,
      disabledToolKeys.join(','),
      mcp,
      rag,
    ].join('|')
  }

  async refreshTools(force = false) {
    if (!this.serviceHub) {
      this.tools = {}
      this.toolsCacheValid = false
      return
    }

    const getDisabledToolsForThread =
      useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()

    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools =
      selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

    let hasDocuments = this.hasDocuments
    let ragFeatureAvailable = this.ragFeatureAvailable

    if (!hasDocuments && this.threadId) {
      const thread = useThreads.getState().threads[this.threadId]
      hasDocuments = Boolean(thread?.metadata?.hasDocuments)
    }
    if (!ragFeatureAvailable) {
      ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
    }

    const cacheKey = this.buildToolsCacheKey(
      disabledToolKeys,
      hasDocuments,
      ragFeatureAvailable,
      modelSupportsTools
    )
    if (!force && this.toolsCacheValid && cacheKey === this.toolsCacheKey) {
      return
    }

    const toolsRecord: Record<string, Tool> = {}

    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    if (modelSupportsTools) {
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
                    tool.inputSchema as Record<string, unknown>
                  ),
                } as Tool
              }
            })
          }
        } catch (error) {
          console.warn('Failed to load RAG tools:', error)
        }
      }

      // Read MCP tools from the global store (populated once at app
      // startup by useTools and refreshed on MCP_UPDATE events). Avoids a
      // cold ~1.8s round-trip into the MCP service on every new thread's
      // first sendMessages call.
      try {
        const mcpTools = useAppState.getState().tools
        if (Array.isArray(mcpTools) && mcpTools.length > 0) {
          // Convert MCP tools to AI SDK format, filtering out disabled tools
          // MCP tools added after RAG tools, so they take precedence in case of name conflicts
          mcpTools.forEach((tool) => {
            // MCP tools use MCPTool interface with server field
            const serverName = (tool as { server?: string }).server || 'unknown'
            if (!isToolDisabled(serverName, tool.name)) {
              toolsRecord[tool.name] = {
                description: tool.description,
                inputSchema: jsonSchema(
                  tool.inputSchema as Record<string, unknown>
                ),
              } as Tool
            }
          })
        }
      } catch (error) {
        console.warn('Failed to load MCP tools:', error)
      }
    }

    const sortedEntries = Object.entries(toolsRecord).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    this.tools = Object.fromEntries(sortedEntries)
    this.toolsCacheKey = cacheKey
    this.toolsCacheValid = true
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
    ttftMark('gammaStart')
    await this.refreshTools()
    ttftMark('gammaEnd')

    // Capture the effective provider name early so the Anthropic serial
    // tool-use repair later uses the same value that was used to create the
    // model, even if the user switches provider mid-request.
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const effectiveProviderName = providerId
    const provider = useModelProvider.getState().getProviderByName(providerId)
    if (this.serviceHub && modelId && provider) {
      try {
        const updatedProvider = useModelProvider
          .getState()
          .getProviderByName(providerId)

        // Get assistant parameters from current assistant
        const currentAssistant = useAssistant.getState().currentAssistant
        const inferenceParams = currentAssistant?.parameters

        // Global "Disable reasoning" setting — best-effort: dispatch the
        // provider-specific flag that skips the thinking phase. Unknown keys
        // are silently ignored by most providers, but we still branch per
        // provider to stay safe with stricter APIs (e.g. Anthropic).
        //
        // The override is kept SEPARATE from `inferenceParams` so local-only
        // fields (top_k, repeat_penalty, …) never leak into cloud-provider
        // request bodies. See ModelFactory for the fetch wiring.
        const { disableReasoning, reasoningBudget } =
          useGeneralSetting.getState()
        const reasoningOverride: Record<string, unknown> = {}
        const reasoningBudgetTokens: Record<
          typeof reasoningBudget,
          number | undefined
        > = {
          off: 0,
          low: 256,
          medium: 1024,
          high: 4096,
          unlimited: undefined,
        }
        if (disableReasoning || reasoningBudget === 'off') {
          switch (effectiveProviderName) {
            case 'llamacpp':
            case 'llamacpp-upstream':
            case 'mlx':
              reasoningOverride.chat_template_kwargs = {
                enable_thinking: false,
              }
              reasoningOverride.reasoning_budget = 0
              break
            case 'anthropic':
              reasoningOverride.thinking = { type: 'disabled' }
              break
            case 'openai':
              reasoningOverride.reasoning_effort = 'minimal'
              break
            case 'xai':
              reasoningOverride.reasoning_effort = 'low'
              break
            case 'google':
            case 'gemini':
              reasoningOverride.reasoning_effort = 'minimal'
              reasoningOverride.extra_body = {
                google: { thinking_config: { thinking_budget: 0 } },
              }
              break
            default:
              reasoningOverride.reasoning_effort = 'minimal'
              reasoningOverride.chat_template_kwargs = {
                enable_thinking: false,
              }
          }
        } else if (
          (effectiveProviderName === 'llamacpp' ||
            effectiveProviderName === 'llamacpp-upstream' ||
            effectiveProviderName === 'mlx') &&
          reasoningBudgetTokens[reasoningBudget] !== undefined
        ) {
          reasoningOverride.reasoning_budget =
            reasoningBudgetTokens[reasoningBudget]
        }
        const hasOverride = Object.keys(reasoningOverride).length > 0

        ttftMark('deltaStart')
        this.model = await ModelFactory.createModel(
          modelId,
          updatedProvider ?? provider,
          inferenceParams ?? {},
          hasOverride ? reasoningOverride : undefined
        )
        ttftMark('deltaEnd')
      } catch (error) {
        console.error('Failed to create model:', error)
        throw new Error(
          `Failed to create model: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        )
      }
    } else {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    // Fix for Anthropic serial tool-use (error 400): when an assistant message
    // contains tool parts interleaved with text parts (serial tool calls),
    // split it into separate messages so convertToModelMessages produces the
    // tool_use / tool_result pairing that the Claude API requires.
    // See: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#parallel-tool-use
    const messagesToConvert = (() => {
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

    // Convert UI messages to model messages
    const baseMessages = convertToModelMessages(
      this.mapUserInlineAttachments(messagesToConvert)
    )

    // If continuing a truncated response, append the partial assistant content as a
    // prefill so the model resumes from where it left off rather than regenerating.
    const continueContent = this.continueFromContent
    this.continueFromContent = null
    const modelMessages = continueContent
      ? [
          ...baseMessages,
          { role: 'assistant' as const, content: continueContent },
        ]
      : baseMessages

    // Local-providers thinking-off ergonomics: when reasoning is OFF on a
    // local backend (mlx, llamacpp, foundation-models), strip the assistant
    // system prompt to a minimal identity stub AND drop tools entirely.
    // Without this, gemma-4 auto-emits CoT whenever (system + tools) are
    // present, even with `chat_template_kwargs.enable_thinking=false`,
    // which tanks TTFT and pollutes the visible content stream.
    const { disableReasoning, reasoningBudget } = useGeneralSetting.getState()
    const reasoningDisabled = disableReasoning || reasoningBudget === 'off'
    const shouldStripLocalContext =
      reasoningDisabled &&
      LOCAL_PROVIDERS_FOR_REASONING_STRIP.has(effectiveProviderName)

    const effectiveSystemMessage = shouldStripLocalContext
      ? renderInstructions(MINIMAL_SYSTEM_PROMPT_TEMPLATE)
      : this.systemMessage

    // Include tools only if we have tools loaded AND model supports them
    // AND we're not in the local thinking-off strip mode.
    const hasTools = Object.keys(this.tools).length > 0
    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools =
      selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools
    const shouldEnableTools =
      !shouldStripLocalContext && hasTools && modelSupportsTools

    // Track stream timing and token count for token speed calculation.
    // We start the clock on the *first generated delta* (text or reasoning),
    // not on the `start` event, so the wall-clock fallback measures decode
    // throughput rather than (TTFT + prefill + decode). Without this, long
    // system prompts and MTP/dflash spin-up artificially deflate the
    // displayed tokens/sec.
    let streamStartTime: number | undefined

    const maxOutputTokens = useAssistant.getState().currentAssistant?.parameters
      ?.max_output_tokens as number | undefined

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: effectiveSystemMessage,
      maxOutputTokens,
      experimental_transform: stripSpecialTokensTransform,
    })

    let tokensPerSecond = 0
    // #region agent log
    const debugLogChunk = (
      _part: { type: string } & Record<string, unknown>
    ): void => {
      /* no-op */
    }
    // #endregion

    const uiStream = result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        // #region agent log
        debugLogChunk(part as unknown as { type: string } & Record<string, unknown>)
        // #endregion
        // Start the wall-clock timer on the first generated delta (text or
        // reasoning), NOT on `start` — the latter fires before prefill, so
        // including it would tank the fallback TPS on long prompts.
        if (
          !streamStartTime &&
          (part.type === 'text-delta' || part.type === 'reasoning-delta')
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

          // Prefer the provider-reported decode TPS (mlx-vlm `generation_tps`
          // or llama.cpp / dflash `predicted_per_second`). Fall back to a
          // wall-clock estimate measured from the first delta — but only if
          // the timer ever started AND we actually produced tokens (e.g. a
          // pure tool-call response yields 0 tokens and no delta, so the
          // fallback would otherwise divide by zero).
          let tokenSpeed: number
          if (tokensPerSecond > 0) {
            tokenSpeed = tokensPerSecond
          } else if (
            streamStartTime !== undefined &&
            durationSec > 0 &&
            outputTokens > 0
          ) {
            tokenSpeed = outputTokens / durationSec
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
        const errorMessage =
          error == null
            ? 'Unknown error'
            : typeof error === 'string'
              ? error
              : error instanceof Error
                ? error.message
                : JSON.stringify(error)

        return errorMessage
      },
      onFinish: ({ responseMessage }) => {
        // Call the token usage callback with usage data when stream completes
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

  /**
   *  Map user messages to include inline attachments in the message parts
   * @param messages
   * @returns
   */
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
          if (message.parts.length > 0) {
            const inlineBlock = inlineFileContents
              .map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`)
              .join('\n\n')
            const lastTextIdx = message.parts.reduce(
              (acc, part, index) => (part.type === 'text' ? index : acc),
              -1
            )
            if (lastTextIdx >= 0) {
              const parts = [...message.parts]
              const part = parts[lastTextIdx]
              if (part.type === 'text') {
                const base = part.text ?? ''
                parts[lastTextIdx] = {
                  type: 'text' as const,
                  text: base ? `${base}\n\n${inlineBlock}` : inlineBlock,
                }
              }
              message.parts = parts
            } else {
              message.parts = [
                ...message.parts,
                { type: 'text' as const, text: inlineBlock },
              ]
            }
          }
        }
      }

      return message
    })
  }
}
