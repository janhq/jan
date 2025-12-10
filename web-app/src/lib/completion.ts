/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { getServiceHub } from '@/hooks/useServiceHub'
import { useAttachments } from '@/hooks/useAttachments'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
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

import { getModelCapabilities } from '@/lib/models'

// Extended config options to include custom fetch function
type ExtendedConfigOptions = ConfigOptions & {
  fetch?: typeof fetch
}
import { ulid } from 'ulidx'
import { MCPTool } from '@/types/completion'
import { CompletionMessagesBuilder, ToolResult } from './messages'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { ExtensionManager } from './extension'
import { useAppState } from '@/hooks/useAppState'
import { injectFilesIntoPrompt } from './fileMetadata'
import { Attachment } from '@/types/attachment'
import { ModelCapabilities } from '@/types/models'

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
  content: string,
  attachments?: Attachment[]
): ThreadMessage => {
  // Separate images and documents
  const images = attachments?.filter((a) => a.type === 'image') || []
  const documents = attachments?.filter((a) => a.type === 'document') || []

  const inlineDocuments = documents.filter(
    (doc) => doc.injectionMode === 'inline' && doc.inlineContent
  )

  // Inject document metadata into the text content (id, name, fileType only - no path)
  const docMetadata = documents
    .map((doc) => ({
      id: doc.id ?? doc.name,
      name: doc.name,
      type: doc.fileType,
      size: typeof doc.size === 'number' ? doc.size : undefined,
      chunkCount: typeof doc.chunkCount === 'number' ? doc.chunkCount : undefined,
      injectionMode: doc.injectionMode,
    }))

  const textWithFiles =
    docMetadata.length > 0 ? injectFilesIntoPrompt(content, docMetadata) : content

  const contentParts = [
    {
      type: ContentType.Text,
      text: {
        value: textWithFiles,
        annotations: [],
      },
    },
  ]

  // Add image attachments to content array
  images.forEach((img) => {
    if (img.base64 && img.mimeType) {
      contentParts.push({
        type: ContentType.Image,
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail: 'auto',
        },
      } as any)
    }
  })

  return {
    type: 'text',
    role: ChatCompletionRole.User,
    content: contentParts,
    id: ulid(),
    object: 'thread.message',
    thread_id: threadId,
    status: MessageStatus.Ready,
    created_at: 0,
    completed_at: 0,
    metadata:
      inlineDocuments.length > 0
        ? {
            inline_file_contents: inlineDocuments.map((doc) => ({
              name: doc.name,
              content: doc.inlineContent,
            })),
          }
        : undefined,
  }
}
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
    apiKey:
      provider.api_key ?? (await getServiceHub().core().getAppToken()) ?? '',
    // TODO: Retrieve from extension settings
    baseURL: provider.base_url,
    // Use Tauri's fetch to avoid CORS issues only for openai-compatible provider
    fetch: IS_DEV ? fetch : getServiceHub().providers().fetch(),
    // OpenRouter identification headers for Jan
    // ref: https://openrouter.ai/docs/api-reference/overview#headers
    ...(provider.provider === 'openrouter' && {
      defaultHeaders: {
        'HTTP-Referer': 'https://jan.ai',
        'X-Title': 'Jan',
      },
    }),
    // Add Origin header for local providers to avoid CORS issues
    ...((provider.base_url?.includes('localhost:') ||
      provider.base_url?.includes('127.0.0.1:')) && {
      fetch: getServiceHub().providers().fetch(),
      defaultHeaders: {
        Origin: 'tauri://localhost',
      },
    }),
  } as ExtendedConfigOptions)

  if (
    thread.model.id &&
    models[providerName]?.models !== true && // Skip if provider accepts any model (models: true)
    !Object.values(models[providerName]).flat().includes(thread.model.id) &&
    !tokenJS.extendedModelExist(providerName as any, thread.model.id) &&
    provider.provider !== 'llamacpp'
  ) {
    try {
      tokenJS.extendModelList(
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

  const providerModelConfig = provider.models?.find(
    (model) => model.id === thread.model?.id || model.model === thread.model?.id
  )
  const effectiveCapabilities = Array.isArray(providerModelConfig?.capabilities)
    ? (providerModelConfig?.capabilities ?? [])
    : getModelCapabilities(provider.provider, thread.model.id)
  const modelSupportsTools = effectiveCapabilities.includes(
    ModelCapabilities.TOOLS
  )
  let usableTools = tools
  if (modelSupportsTools) {
    usableTools = [...tools]
  }
  const engine = ExtensionManager.getInstance().getEngine(provider.provider)

  const completion = engine
    ? await engine.chat(
        {
          messages: messages as chatCompletionRequestMessage[],
          model: thread.model?.id,
          thread_id: thread.id,
          tools: normalizeTools(usableTools),
          tool_choice: usableTools.length ? 'auto' : undefined,
          stream: true,
          ...params,
        },
        abortController
      )
    : stream
      ? await tokenJS.chat.completions.create(
          {
            stream: true,

            provider: providerName as any,
            model: thread.model?.id,
            messages,
            tools: normalizeTools(usableTools),
            tool_choice: usableTools.length ? 'auto' : undefined,
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
          tools: normalizeTools(usableTools),
          tool_choice: usableTools.length ? 'auto' : undefined,
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
 * Helper function to check if a tool call is a browser MCP tool
 * @param toolName - The name of the tool
 * @returns true if the tool is a browser-related MCP tool
 */
const isBrowserMCPTool = (toolName: string): boolean => {
  const browserToolPrefixes = [
    'browser',
    'browserbase',
    'browsermcp',
    'multi_browserbase',
  ]
  return browserToolPrefixes.some((prefix) =>
    toolName.toLowerCase().startsWith(prefix)
  )
}

/**
 * Helper function to capture screenshot and snapshot proactively
 * @param abortController - The abort controller for cancellation
 * @returns Promise with screenshot and snapshot results
 */
export const captureProactiveScreenshots = async (
  abortController: AbortController
): Promise<ToolResult[]> => {
  const results: ToolResult[] = []

  try {
    // Get available tools
    const allTools = await getServiceHub().mcp().getTools()

    // Find screenshot and snapshot tools
    const screenshotTool = allTools.find((t) =>
      t.name.toLowerCase().includes('screenshot')
    )
    const snapshotTool = allTools.find((t) =>
      t.name.toLowerCase().includes('snapshot')
    )

    // Capture screenshot if available
    if (screenshotTool && !abortController.signal.aborted) {
      try {
        const { promise } = getServiceHub().mcp().callToolWithCancellation({
          toolName: screenshotTool.name,
          serverName: screenshotTool.server,
          arguments: {},
        })
        const screenshotResult = await promise
        if (screenshotResult && typeof screenshotResult !== 'string') {
          results.push(screenshotResult as ToolResult)
        }
      } catch (e) {
        console.warn('Failed to capture proactive screenshot:', e)
      }
    }

    // Capture snapshot if available
    if (snapshotTool && !abortController.signal.aborted) {
      try {
        const { promise } = getServiceHub().mcp().callToolWithCancellation({
          toolName: snapshotTool.name,
          serverName: snapshotTool.server,
          arguments: {},
        })
        const snapshotResult = await promise
        if (snapshotResult && typeof snapshotResult !== 'string') {
          results.push(snapshotResult as ToolResult)
        }
      } catch (e) {
        console.warn('Failed to capture proactive snapshot:', e)
      }
    }
  } catch (e) {
    console.error('Failed to get MCP tools for proactive capture:', e)
  }

  return results
}

/**
 * Helper function to filter out old screenshot/snapshot images from builder messages
 * Keeps only the latest proactive screenshots
 * @param builder - The completion messages builder
 */
const filterOldProactiveScreenshots = (builder: CompletionMessagesBuilder) => {
  const messages = builder.getMessages()
  const filteredMessages: any[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // If it's a tool message with array content (multimodal)
      if (Array.isArray(msg.content)) {
        // Filter out images, keep text only for old tool messages
        const textOnly = msg.content.filter(
          (part: any) => part.type !== 'image_url'
        )
        if (textOnly.length > 0) {
          filteredMessages.push({ ...msg, content: textOnly })
        }
      } else {
        // Keep string content as-is
        filteredMessages.push(msg)
      }
    } else {
      // Keep all non-tool messages
      filteredMessages.push(msg)
    }
  }

  // Reconstruct builder with filtered messages
  // Note: This is a workaround since CompletionMessagesBuilder doesn't have a setter
  // We'll need to access the private messages array
  // eslint-disable-next-line no-extra-semi
  ;(builder as any).messages = filteredMessages
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
 * @param isProactiveMode
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
  allowAllMCPPermissions: boolean = false,
  isProactiveMode: boolean = false
) => {
  // Handle completed tool calls
  if (calls.length) {
    // Fetch RAG tool names from RAG service
    let ragToolNames = new Set<string>()
    try {
      const names = await getServiceHub().rag().getToolNames()
      ragToolNames = new Set(names)
    } catch (e) {
      console.error('Failed to load RAG tool names:', e)
    }
    const ragFeatureAvailable =
      useAttachments.getState().enabled &&
      PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
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
          console.log('Raw tool arguments:', toolCall.function.arguments)
          toolParameters = JSON.parse(toolCall.function.arguments)
          console.log('Parsed tool parameters:', toolParameters)
        } catch (error) {
          console.error('Failed to parse tool arguments:', error)
          console.error(
            'Raw arguments that failed:',
            toolCall.function.arguments
          )
        }
      }

      const toolName = toolCall.function.name
      const toolArgs = toolCall.function.arguments.length ? toolParameters : {}
      const isRagTool = ragToolNames.has(toolName)
      const isBrowserTool = isBrowserMCPTool(toolName)

      // Auto-approve RAG tools (local/safe operations), require permission for MCP tools
      const approved = isRagTool
        ? true
        : allowAllMCPPermissions ||
          approvedTools[message.thread_id]?.includes(toolCall.function.name) ||
          (showModal
            ? await showModal(
                toolCall.function.name,
                message.thread_id,
                toolParameters
              )
            : true)

      const { promise, cancel } = isRagTool
        ? ragFeatureAvailable
          ? {
              promise: getServiceHub().rag().callTool({ toolName, arguments: toolArgs, threadId: message.thread_id }),
              cancel: async () => {},
            }
          : {
              promise: Promise.resolve({
                error: 'attachments_unavailable',
                content: [
                  {
                    type: 'text',
                    text: 'Attachments feature is disabled or unavailable on this platform.',
                  },
                ],
              }),
              cancel: async () => {},
            }
        : await (async () => {
            // Find server name for this MCP tool from available tools
            let serverName: string | undefined
            try {
              const availableTools = await getServiceHub().mcp().getTools()
              const matchingTool = availableTools.find(t => t.name === toolName)
              serverName = matchingTool?.server
            } catch (e) {
              console.warn('Failed to lookup server for tool:', toolName, e)
            }

            return getServiceHub().mcp().callToolWithCancellation({
              toolName,
              serverName,
              arguments: toolArgs,
            })
          })()

      useAppState.getState().setCancelToolCall(cancel)

      let result = approved
        ? await promise.catch((e) => {
            console.error('Tool call failed:', e)
            return {
              content: [
                {
                  type: 'text',
                  text: `Error calling tool ${toolCall.function.name}: ${e.message ?? e}`,
                },
              ],
              error: String(e?.message ?? e ?? 'Tool call failed'),
            }
          })
        : {
            content: [
              {
                type: 'text',
                text: 'The user has chosen to disallow the tool call.',
              },
            ],
            error: 'disallowed',
          }

      if (typeof result === 'string') {
        result = {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
          error: '',
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
      builder.addToolMessage(result as ToolResult, toolCall.id)

      // Proactive mode: Capture screenshot/snapshot after browser tool execution
      if (isProactiveMode && isBrowserTool && !abortController.signal.aborted) {
        console.log('Proactive mode: Capturing screenshots after browser tool call')

        // Filter out old screenshots before adding new ones
        filterOldProactiveScreenshots(builder)

        // Capture new screenshots
        const proactiveScreenshots = await captureProactiveScreenshots(abortController)

        // Add proactive screenshots to builder
        for (const screenshot of proactiveScreenshots) {
          // Generate a unique tool call ID for the proactive screenshot
          const proactiveToolCallId = ulid()
          builder.addToolMessage(screenshot, proactiveToolCallId)

          console.log('Proactive screenshot captured and added to context')
        }
      }

      // update message metadata
    }
    return message
  }
}
