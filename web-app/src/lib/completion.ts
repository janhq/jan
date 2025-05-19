import {
  ContentType,
  ChatCompletionRole,
  ThreadMessage,
  MessageStatus,
  EngineManager,
  ModelManager,
} from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  CompletionResponseChunk,
  models,
  StreamCompletionResponse,
  TokenJS,
} from 'token.js'
import { ulid } from 'ulidx'
import { normalizeProvider } from './models'
import { MCPTool } from '@/types/completion'
import { CompletionMessagesBuilder } from './messages'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { callTool } from '@/services/mcp'

/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newUserThreadContent = (
  threadId: string,
  content: string
): ThreadMessage => ({
  type: 'text',
  role: ChatCompletionRole.User,
  content: [
    {
      type: ContentType.Text,
      text: {
        value: content,
        annotations: [],
      },
    },
  ],
  id: ulid(),
  object: 'thread.message',
  thread_id: threadId,
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
})
/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newAssistantThreadContent = (
  threadId: string,
  content: string
): ThreadMessage => ({
  type: 'text',
  role: ChatCompletionRole.Assistant,
  content: [
    {
      type: ContentType.Text,
      text: {
        value: content,
        annotations: [],
      },
    },
  ],
  id: ulid(),
  object: 'thread.message',
  thread_id: threadId,
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
})

/**
 * Empty thread content object.
 * @returns
 */
export const emptyThreadContent: ThreadMessage = {
  type: 'text',
  role: ChatCompletionRole.Assistant,
  id: ulid(),
  object: 'thread.message',
  thread_id: '',
  content: [],
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
}

/**
 * @fileoverview Helper function to send a completion request to the model provider.
 * @param thread
 * @param provider
 * @param messages
 * @returns
 */
export const sendCompletion = async (
  thread: Thread,
  provider: ModelProvider,
  messages: ChatCompletionMessageParam[],
  tools: MCPTool[] = []
): Promise<StreamCompletionResponse | undefined> => {
  if (!thread?.model?.id || !provider) return undefined

  let providerName = provider.provider as unknown as keyof typeof models

  if (!Object.keys(models).some((key) => key === providerName))
    providerName = 'openai-compatible'

  const tokenJS = new TokenJS({
    apiKey: provider.api_key ?? (await invoke('app_token')),
    // TODO: Retrieve from extension settings
    baseURL: provider.base_url,
  })

  // TODO: Add message history
  const completion = await tokenJS.chat.completions.create({
    stream: true,
    provider: providerName,
    model: thread.model?.id,
    messages,
    tools: normalizeTools(tools),
    tool_choice: tools.length ? 'auto' : undefined,
  })
  return completion
}

/**
 * @fileoverview Helper function to start a model.
 * This function loads the model from the provider.
 * @deprecated This function is deprecated and will be removed in the future.
 * Provider's chat function will handle loading the model.
 * @param provider
 * @param model
 * @returns
 */
export const startModel = async (
  provider: string,
  model: string
): Promise<void> => {
  const providerObj = EngineManager.instance().get(normalizeProvider(provider))
  const modelObj = ModelManager.instance().get(model)
  if (providerObj && modelObj) return providerObj?.loadModel(modelObj)
}

/**
 * @fileoverview Helper function to stop a model.
 * This function unloads the model from the provider.
 * @param provider
 * @param model
 * @returns
 */
export const stopModel = async (
  provider: string,
  model: string
): Promise<void> => {
  const providerObj = EngineManager.instance().get(normalizeProvider(provider))
  const modelObj = ModelManager.instance().get(model)
  if (providerObj && modelObj) return providerObj?.unloadModel(modelObj)
}

/**
 * @fileoverview Helper function to normalize tools for the chat completion request.
 * This function converts the MCPTool objects to ChatCompletionTool objects.
 * @param tools
 * @returns
 */
export const normalizeTools = (tools: MCPTool[]): ChatCompletionTool[] => {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description?.slice(0, 1024),
      parameters: tool.inputSchema,
      strict: false,
    },
  }))
}

/**
 * @fileoverview Helper function to extract tool calls from the completion response.
 * @param part
 * @param calls
 */
export const extractToolCall = (
  part: CompletionResponseChunk,
  currentCall: ChatCompletionMessageToolCall | null,
  calls: ChatCompletionMessageToolCall[]
) => {
  const deltaToolCalls = part.choices[0].delta.tool_calls
  // Handle the beginning of a new tool call
  if (deltaToolCalls?.[0]?.index !== undefined && deltaToolCalls[0]?.function) {
    const index = deltaToolCalls[0].index

    // Create new tool call if this is the first chunk for it
    if (!calls[index]) {
      calls[index] = {
        id: deltaToolCalls[0]?.id || '',
        function: {
          name: deltaToolCalls[0]?.function?.name || '',
          arguments: deltaToolCalls[0]?.function?.arguments || '',
        },
        type: 'function',
      }
      currentCall = calls[index]
    } else {
      // Continuation of existing tool call
      currentCall = calls[index]

      // Append to function name or arguments if they exist in this chunk
      if (deltaToolCalls[0]?.function?.name) {
        currentCall!.function.name += deltaToolCalls[0].function.name
      }

      if (deltaToolCalls[0]?.function?.arguments) {
        currentCall!.function.arguments += deltaToolCalls[0].function.arguments
      }
    }
  }
  return calls
}

/**
 * @fileoverview Helper function to process the completion response.
 * @param calls
 * @param builder
 * @param message
 * @param content
 */
export const postMessageProcessing = async (
  calls: ChatCompletionMessageToolCall[],
  builder: CompletionMessagesBuilder,
  message: ThreadMessage
) => {
  // Handle completed tool calls
  if (calls.length) {
    for (const toolCall of calls) {
      const toolId = ulid()
      const toolCallsMetadata =
        message.metadata?.tool_calls &&
        Array.isArray(message.metadata?.tool_calls)
          ? message.metadata?.tool_calls
          : []
      message.metadata = {
        ...(message.metadata ?? {}),
        tool_calls: [
          ...toolCallsMetadata,
          {
            tool: {
              ...(toolCall as object),
              id: toolId,
            },
            response: undefined,
            state: 'pending',
          },
        ],
      }

      const result = await callTool({
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments.length
          ? JSON.parse(toolCall.function.arguments)
          : {},
      })
      // @ts-ignore
      if (result.error) break

      message.metadata = {
        ...(message.metadata ?? {}),
        tool_calls: [
          ...toolCallsMetadata,
          {
            tool: {
              ...toolCall,
              id: toolId,
            },
            response: result,
            state: 'ready',
          },
        ],
      }
      // @ts-ignore
      builder.addToolMessage(result.content[0]?.text ?? '', toolCall.id)
      // update message metadata
      return message
    }
  }
}
