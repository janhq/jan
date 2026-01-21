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
  models(): {
    startModel(provider: ProviderObject, model: string): Promise<unknown>
  }
}

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private onStreamingTokenSpeed?: StreamingTokenSpeedCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private modelId?: string
  private provider?: ProviderObject
  private serviceHub: ServiceHub | null
  private threadId?: string

  constructor(
    modelId: string | undefined,
    provider: ProviderObject | undefined,
    systemMessage?: string,
    threadId?: string
  ) {
    this.model = null
    this.modelId = modelId
    this.provider = provider
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.serviceHub = useServiceStore.getState().serviceHub
    // Tools will be loaded when updateRagToolsAvailability is called with model capabilities
  }

  updateModelMetadata(modelId: string, provider: ProviderObject) {
    this.modelId = modelId
    this.provider = provider
    // Reset model so it gets recreated with new metadata on next sendMessages
    this.model = null
  }

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  setOnStreamingTokenSpeed(callback: StreamingTokenSpeedCallback | undefined) {
    this.onStreamingTokenSpeed = callback
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
  private async refreshTools() {
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
      : []

    // Helper to check if a tool is disabled
    const isToolDisabled = (serverName: string, toolName: string): boolean => {
      const toolKey = `${serverName}::${toolName}`
      return disabledToolKeys.includes(toolKey)
    }

    // Only load tools if model supports them
    if (this.modelSupportsTools) {
      // Load RAG tools if documents are available
      if (this.hasDocuments && this.ragFeatureAvailable) {
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
   * Force refresh tools from services
   * Called when MCP server status changes or tools are updated
   */
  async forceRefreshTools() {
    await this.refreshTools()
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
    // Initialize model if not already initialized
    if (this.serviceHub && this.modelId && this.provider) {
      try {
        const updatedProvider = useModelProvider
          .getState()
          .getProviderByName(this.provider.provider)
        // Start the model (this will be a no-op for remote providers)
        await this.serviceHub
          .models()
          .startModel(updatedProvider ?? this.provider, this.modelId)

        // Create the model using the factory
        this.model = await ModelFactory.createModel(
          this.modelId,
          updatedProvider ?? this.provider
        )
      } catch (error) {
        console.error('Failed to start model:', error)
        throw new Error(
          `Failed to start model: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } else {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    // Convert UI messages to model messages
    const modelMessages = convertToModelMessages(
      this.mapUserInlineAttachments(options.messages)
    )

    // Include tools only if we have tools loaded AND model supports them
    const hasTools = Object.keys(this.tools).length > 0
    const shouldEnableTools = hasTools && this.modelSupportsTools

    // Track stream timing and token count for token speed calculation
    let streamStartTime: number | undefined
    let textDeltaCount = 0

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? this.tools : undefined,
      toolChoice: shouldEnableTools ? 'auto' : undefined,
      system: this.systemMessage,
    })

    return result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        // Track stream start time on first text delta
        if (part.type === 'text-delta') {
          if (!streamStartTime) {
            streamStartTime = Date.now()
          }
          // Count text deltas as a rough token approximation
          // Each delta typically represents one token in streaming
          textDeltaCount++

          // Report streaming token speed in real-time
          if (this.onStreamingTokenSpeed) {
            const elapsedMs = Date.now() - streamStartTime
            this.onStreamingTokenSpeed(textDeltaCount, elapsedMs)
          }
        }

        // Add usage and token speed to metadata on finish
        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
            providerMetadata?: {
              llamacpp?: {
                promptTokens?: number | null
                completionTokens?: number | null
                tokensPerSecond?: number | null
              }
            }
          }
          const usage = finishPart.totalUsage
          const llamacppMeta = finishPart.providerMetadata?.llamacpp
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          // Use provider's outputTokens, or llama.cpp completionTokens, or fall back to text delta count
          const outputTokens =
            usage?.outputTokens ??
            llamacppMeta?.completionTokens ??
            textDeltaCount
          const inputTokens = usage?.inputTokens ?? llamacppMeta?.promptTokens

          // Use llama.cpp's tokens per second if available, otherwise calculate from duration
          let tokenSpeed: number
          if (llamacppMeta?.tokensPerSecond != null) {
            tokenSpeed = llamacppMeta.tokensPerSecond
          } else if (durationSec > 0 && outputTokens > 0) {
            tokenSpeed = outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          return {
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
        // Note: By default, the AI SDK will return "An error occurred",
        // which is intentionally vague in case the error contains sensitive information like API keys.
        // If you want to provide more detailed error messages, keep the code below. Otherwise, remove this whole onError callback.
        if (error == null) {
          return 'Unknown error'
        }
        if (typeof error === 'string') {
          return error
        }
        if (error instanceof Error) {
          return error.message
        }
        return JSON.stringify(error)
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
        const inlineFileContents = Array.isArray(
          (message.metadata as any)?.inline_file_contents
        )
          ? (
              (message.metadata as any)?.inline_file_contents as Array<{
                name?: string
                content?: string
              }>
            ).filter((f) => f?.content)
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
