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
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'

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
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private continueFromContent: string | null = null

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
  async refreshTools() {
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

      // Load MCP tools (they don't depend on documents)
      try {
        const mcpTools = await this.serviceHub.mcp().getTools()
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

    this.tools = toolsRecord
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
    // Ensure tools updated before sending messages
    await this.refreshTools()

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

        // Create the model using the factory
        // For llamacpp provider, startModel is called internally in ModelFactory.createLlamaCppModel
        this.model = await ModelFactory.createModel(
          modelId,
          updatedProvider ?? provider,
          inferenceParams ?? {}
        )
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
      ? [...baseMessages, { role: 'assistant' as const, content: continueContent }]
      : baseMessages

    // Include tools only if we have tools loaded AND model supports them
    const hasTools = Object.keys(this.tools).length > 0
    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools = selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools
    const shouldEnableTools = hasTools && modelSupportsTools

    // Track stream timing and token count for token speed calculation
    let streamStartTime: number | undefined

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: this.systemMessage,
    })

    let tokensPerSecond = 0

    const uiStream = result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        // Track stream start time on start
        if (part.type === 'start' && !streamStartTime) {
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
