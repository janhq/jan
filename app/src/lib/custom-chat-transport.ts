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
  private enabledTool = false

  constructor(model: LanguageModel, enabledTool?: boolean) {
    this.model = model
    this.enabledTool = enabledTool ?? false
    this.initializeTools()
  }

  updateModel(model: LanguageModel) {
    this.model = model
  }

  /**
   * Initialize MCP tools and convert them to AI SDK format
   */
  private async initializeTools() {
    try {
      const toolsResponse = await mcpService.getTools()

      // Convert MCP tools to AI SDK CoreTool format
      this.tools = toolsResponse.data.reduce((acc, tool) => {
        acc[tool.name] = {
          description: tool.description,
          inputSchema: jsonSchema(tool.inputSchema),
          name: tool.name,
        }
        return acc
      }, {} as Record<string, Tool>)

      console.log(`Initialized ${Object.keys(this.tools).length} MCP tools`)
    } catch (error) {
      console.error('Failed to initialize MCP tools:', error)
      this.tools = {}
    }
  }

  /**
   * Refresh tools from MCP server
   */
  async refreshTools() {
    await this.initializeTools()
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

    await this.refreshTools()
    const result = streamText({
      model: this.model,
      messages: convertToModelMessages(options.messages),
      abortSignal: options.abortSignal,
      tools: this.enabledTool ? this.tools : undefined,
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
