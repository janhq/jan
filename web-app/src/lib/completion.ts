import {
  ContentType,
  ChatCompletionRole,
  ThreadMessage,
  MessageStatus,
  EngineManager,
  ModelManager,
  chatCompletionRequestMessage,
  chatCompletion,
  chatCompletionChunk,
  Tool,
} from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  CompletionResponse,
  CompletionResponseChunk,
  models,
  StreamCompletionResponse,
  TokenJS,
  ConfigOptions,
} from 'token.js'

// Extended config options to include custom fetch function
type ExtendedConfigOptions = ConfigOptions & {
  fetch?: typeof fetch
}
import { ulid } from 'ulidx'
import { MCPTool } from '@/types/completion'
import { CompletionMessagesBuilder } from './messages'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { callTool } from '@/services/mcp'
import { ExtensionManager } from './extension'

export type ChatCompletionResponse =
  | chatCompletion
  | AsyncIterable<chatCompletionChunk>
  | StreamCompletionResponse
  | CompletionResponse

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
  content: string,
  metadata: Record<string, unknown> = {}
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
  metadata,
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
  abortController: AbortController,
  tools: MCPTool[] = [],
  stream: boolean = true,
  params: Record<string, object> = {}
): Promise<ChatCompletionResponse | undefined> => {
  if (!thread?.model?.id || !provider) return undefined

  let providerName = provider.provider as unknown as keyof typeof models

  if (!Object.keys(models).some((key) => key === providerName))
    providerName = 'openai-compatible'

  const tokenJS = new TokenJS({
    apiKey: provider.api_key ?? (await invoke('app_token')),
    // TODO: Retrieve from extension settings
    baseURL: provider.base_url,
    // Use Tauri's fetch to avoid CORS issues only for openai-compatible provider
    ...(providerName === 'openai-compatible' && { fetch: fetchTauri }),
    // OpenRouter identification headers for Jan
    // ref: https://openrouter.ai/docs/api-reference/overview#headers
    ...(provider.provider === 'openrouter' && {
      defaultHeaders: {
        'HTTP-Referer': 'https://jan.ai',
        'X-Title': 'Jan',
      },
    }),
  } as ExtendedConfigOptions)

  if (
    thread.model.id &&
    !Object.values(models[providerName]).flat().includes(thread.model.id) &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !tokenJS.extendedModelExist(providerName as any, thread.model.id) &&
    provider.provider !== 'llamacpp'
  ) {
    try {
      tokenJS.extendModelList(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerName as any,
        thread.model.id,
        // This is to inherit the model capabilities from another built-in model
        // Can be anything that support all model capabilities
        models.anthropic.models[0]
      )
    } catch (error) {
      console.error(
        `Failed to extend model list for ${providerName} with model ${thread.model.id}:`,
        error
      )
    }
  }

  const engine = ExtensionManager.getInstance().getEngine(provider.provider)

  const completion = engine
    ? await engine.chat(
        {
          messages: messages as chatCompletionRequestMessage[],
          model: thread.model?.id,
          tools: normalizeTools(tools),
          tool_choice: tools.length ? 'auto' : undefined,
          stream: true,
          ...params,
        },
        abortController
      )
    : stream
      ? await tokenJS.chat.completions.create(
          {
            stream: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: providerName as any,
            model: thread.model?.id,
            messages,
            tools: normalizeTools(tools),
            tool_choice: tools.length ? 'auto' : undefined,
            ...params,
          },
          {
            signal: abortController.signal,
          }
        )
      : await tokenJS.chat.completions.create({
          stream: false,
          provider: providerName,
          model: thread.model?.id,
          messages,
          tools: normalizeTools(tools),
          tool_choice: tools.length ? 'auto' : undefined,
          ...params,
        })
  return completion
}

export const isCompletionResponse = (
  response: ChatCompletionResponse
): response is CompletionResponse | chatCompletion => {
  return 'choices' in response
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
  const providerObj = EngineManager.instance().get(provider)
  const modelObj = ModelManager.instance().get(model)
  if (providerObj && modelObj) return providerObj?.unload(model).then(() => {})
}

/**
 * @fileoverview Helper function to normalize tools for the chat completion request.
 * This function converts the MCPTool objects to ChatCompletionTool objects.
 * @param tools
 * @returns
 */
export const normalizeTools = (
  tools: MCPTool[]
): ChatCompletionTool[] | Tool[] | undefined => {
  if (tools.length === 0) return undefined
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
  part: chatCompletionChunk | CompletionResponseChunk,
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
        id: deltaToolCalls[0]?.id || ulid(),
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
      if (
        deltaToolCalls[0]?.function?.name &&
        currentCall!.function.name !== deltaToolCalls[0]?.function?.name
      ) {
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
 * @param abortController
 * @param approvedTools
 * @param showModal
 * @param allowAllMCPPermissions
 */
export const postMessageProcessing = async (
  calls: ChatCompletionMessageToolCall[],
  builder: CompletionMessagesBuilder,
  message: ThreadMessage,
  abortController: AbortController,
  approvedTools: Record<string, string[]> = {},
  showModal?: (
    toolName: string,
    threadId: string,
    toolParameters?: object
  ) => Promise<boolean>,
  allowAllMCPPermissions: boolean = false
) => {
  // Handle completed tool calls
  if (calls.length) {
    for (const toolCall of calls) {
      if (abortController.signal.aborted) break
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

      // Check if tool is approved or show modal for approval
      let toolParameters = {}
      if (toolCall.function.arguments.length) {
        try {
          toolParameters = JSON.parse(toolCall.function.arguments)
        } catch (error) {
          console.error('Failed to parse tool arguments:', error)
        }
      }
      const approved =
        allowAllMCPPermissions ||
        approvedTools[message.thread_id]?.includes(toolCall.function.name) ||
        (showModal
          ? await showModal(
              toolCall.function.name,
              message.thread_id,
              toolParameters
            )
          : true)

      let result = approved
        ? await callTool({
            toolName: toolCall.function.name,
            arguments: toolCall.function.arguments.length
              ? JSON.parse(toolCall.function.arguments)
              : {},
          }).catch((e) => {
            console.error('Tool call failed:', e)
            return {
              content: [
                {
                  type: 'text',
                  text: `Error calling tool ${toolCall.function.name}: ${e.message ?? e}`,
                },
              ],
              error: true,
            }
          })
        : {
            content: [
              {
                type: 'text',
                text: 'The user has chosen to disallow the tool call.',
              },
            ],
          }

      if (typeof result === 'string') {
        result = {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        }
      }

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
      builder.addToolMessage(result.content[0]?.text ?? '', toolCall.id)
      // update message metadata
    }
    return message
  }
}
