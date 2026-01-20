import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  type CoreMessage,
  type LanguageModelUsage,
  jsonSchema,
} from 'ai'
import { useServiceStore } from '@/hooks/useServiceHub'
import { ModelFactory } from './model-factory'

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
// import { mcpService } from "@/services/mcp-service";

/**
 * Custom download function that returns null for all URLs.
 * This tells the AI SDK to pass URLs directly to the model
 * instead of downloading and converting to base64.
 *
 * This avoids CORS issues with presigned S3 URLs and reduces payload size.
 */
async function passUrlsDirectly(
  options: Array<{ url: URL; isUrlSupportedByModel: boolean }>
): Promise<Array<{ data: Uint8Array; mediaType: string | undefined } | null>> {
  // Return null for all URLs to pass them directly to the model
  return options.map(() => null)
}

/**
 * Convert file parts to custom image_url format for the API.
 * The server expects: { type: "image_url", image_url: { url: "<image url>", detail: "auto" } }
 */
function convertToImageUrlFormat(messages: CoreMessage[]): CoreMessage[] {
  return messages.map((message) => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) => {
          // Convert image parts to image_url format
          if (part.type === 'image' && 'image' in part) {
            const imageData = part.image
            // If it's a URL string
            if (typeof imageData === 'string') {
              return {
                type: 'image_url',
                image_url: {
                  url: imageData,
                  detail: 'auto',
                },
              }
            }
          }
          return part
        }),
      }
    }
    return message
  }) as CoreMessage[]
}

/**
 * Filter out base64 image data from tool messages to reduce payload size.
 * Browser MCP tools return screenshots as base64 which are very large.
 * We replace them with a placeholder to avoid sending huge payloads to the API.
 */
function filterBase64FromMessages(messages: CoreMessage[]): CoreMessage[] {
  const base64Pattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g

  return messages.map((message) => {
    if (message.role === 'tool') {
      // Tool messages have content as array of ToolResultPart
      if (Array.isArray(message.content)) {
        return {
          ...message,
          content: message.content.map((part) => {
            // ToolResultPart has type 'tool-result' with a result property
            // The result can contain text with embedded base64
            if ('result' in part && part.result) {
              const resultStr =
                typeof part.result === 'string'
                  ? part.result
                  : JSON.stringify(part.result)

              if (base64Pattern.test(resultStr)) {
                return {
                  ...part,
                  result: resultStr.replace(
                    base64Pattern,
                    '[base64 image data removed]'
                  ),
                }
              }
            }
            return part
          }),
        }
      }
    }

    // Handle user messages with image parts
    if (message.role === 'user' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) => {
          // Check for image parts with base64 data
          if (part.type === 'image') {
            const imageData = 'image' in part ? part.image : null
            if (
              typeof imageData === 'string' &&
              (imageData.startsWith('data:') || imageData.length > 10000)
            ) {
              // Replace with placeholder text
              return {
                type: 'text',
                text: `[Image: screenshot captured]`,
              }
            }
          }
          // Check for text parts with embedded base64
          if (
            part.type === 'text' &&
            'text' in part &&
            typeof part.text === 'string'
          ) {
            if (base64Pattern.test(part.text)) {
              return {
                ...part,
                text: part.text.replace(
                  base64Pattern,
                  '[base64 image data removed]'
                ),
              }
            }
          }
          return part
        }),
      }
    }

    return message
  })
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

  constructor(
    modelId: string | undefined,
    provider: ProviderObject | undefined,
    systemMessage?: string
  ) {
    this.model = null
    this.modelId = modelId
    this.provider = provider
    this.systemMessage = systemMessage
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
   * @private
   */
  private async refreshTools() {
    if (!this.serviceHub) {
      this.tools = {}
      return
    }

    const toolsRecord: Record<string, Tool> = {}

    // Only load tools if model supports them
    if (this.modelSupportsTools) {
      // Load RAG tools if documents are available
      if (this.hasDocuments && this.ragFeatureAvailable) {
        try {
          const ragTools = await this.serviceHub.rag().getTools()
          if (Array.isArray(ragTools) && ragTools.length > 0) {
            // Convert RAG tools to AI SDK format
            ragTools.forEach((tool) => {
              toolsRecord[tool.name] = {
                description: tool.description,
                inputSchema: jsonSchema(
                  tool.inputSchema as Record<string, unknown>
                ),
              } as Tool
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
          // Convert MCP tools to AI SDK format
          // MCP tools added after RAG tools, so they take precedence in case of name conflicts
          mcpTools.forEach((tool) => {
            toolsRecord[tool.name] = {
              description: tool.description,
              inputSchema: jsonSchema(
                tool.inputSchema as Record<string, unknown>
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

  /**
   * Get current tools
   */
  getTools(): Record<string, Tool> {
    return this.tools
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
        // Start the model (this will be a no-op for remote providers)
        await this.serviceHub.models().startModel(this.provider, this.modelId)

        // Create the model using the factory
        this.model = await ModelFactory.createModel(this.modelId, this.provider)
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
    const modelMessages = convertToModelMessages(options.messages)

    // Filter out base64 data from tool results
    const filteredMessages = filterBase64FromMessages(modelMessages)

    // Convert image parts to image_url format for the API
    const messagesWithImageUrls = convertToImageUrlFormat(filteredMessages)

    // Include tools only if we have tools loaded AND model supports them
    const hasTools = Object.keys(this.tools).length > 0
    const shouldEnableTools = hasTools && this.modelSupportsTools

    // Track stream timing and token count for token speed calculation
    let streamStartTime: number | undefined
    let textDeltaCount = 0

    const result = streamText({
      model: this.model,
      messages: messagesWithImageUrls,
      abortSignal: options.abortSignal,
      // Pass URLs directly to the model instead of downloading
      // This avoids CORS issues with presigned S3 URLs
      experimental_download: passUrlsDirectly,
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
}
