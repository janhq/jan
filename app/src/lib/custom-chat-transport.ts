import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  jsonSchema,
} from 'ai'
import { mcpService } from '@/services/mcp-service'

export class CustomChatTransport implements ChatTransport<UIMessage> {
  private model: LanguageModel
  private tools: Record<string, Tool> = {}
  private enabledSearch = false
  private enableBrowse = false

  constructor(
    model: LanguageModel,
    enabledSearch?: boolean,
    enableBrowse?: boolean
  ) {
    this.model = model
    this.enabledSearch = enabledSearch ?? false
    this.enableBrowse = enableBrowse ?? false
    this.initializeTools()
  }

  updateModel(model: LanguageModel) {
    this.model = model
  }

  updateSearchEnabled(enabledSearch: boolean) {
    this.enabledSearch = enabledSearch
  }
  updateBrowseEnabled(enableBrowse: boolean) {
    this.enableBrowse = enableBrowse
  }

  /**
   * Initialize MCP tools and convert them to AI SDK format
   */
  private async initializeTools() {
    try {
      const toolsResponse = await mcpService.getTools(
        [
          this.enabledSearch ? 'search' : null,
          this.enableBrowse ? 'browse' : null,
        ].filter(Boolean) as string[]
      )

      // Convert MCP tools to AI SDK CoreTool format
      this.tools = toolsResponse.data.reduce(
        (acc, tool) => {
          acc[tool.name] = {
            description: tool.description,
            inputSchema: jsonSchema(tool.inputSchema),
            name: tool.name,
          }
          return acc
        },
        {} as Record<string, Tool>
      )

      console.log(`Initialized ${Object.keys(this.tools).length} MCP tools`)
    } catch (error) {
      console.error('Failed to initialize MCP tools:', error)
      this.tools = {}
    }
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
    await this.initializeTools()
    const result = streamText({
      model: this.model,
      messages: convertToModelMessages(options.messages),
      abortSignal: options.abortSignal,
      tools:
        (this.enabledSearch || this.enableBrowse) &&
        Object.keys(this.tools).length > 0
          ? this.tools
          : undefined,
      toolChoice: 'auto',
    })

    return result.toUIMessageStream({
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
