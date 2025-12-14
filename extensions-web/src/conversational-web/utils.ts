import { Thread, ThreadAssistantInfo, ThreadMessage, ContentType } from '@janhq/core'
import { Conversation, ConversationResponse, ConversationItem, ConversationItemContent, ConversationMetadata } from './types'
import { DEFAULT_ASSISTANT } from './const'

/**
 * Gets the default model ID from localStorage or returns fallback
 * The model list should be synced to localStorage by jan-provider-web
 */
function getDefaultModelIdFromStorage(): { id: string; engine: string } {
  try {
    // Try to get models from localStorage (set by jan-provider-web)
    const modelsJson = localStorage.getItem('jan-models')
    if (modelsJson) {
      const models = JSON.parse(modelsJson)
      if (Array.isArray(models) && models.length > 0) {
        // Sort by category_order_number, then model_order_number
        const sortedModels = [...models].sort((a: any, b: any) => {
          const categoryDiff = (a.category_order_number ?? Number.MAX_SAFE_INTEGER) - 
                              (b.category_order_number ?? Number.MAX_SAFE_INTEGER)
          if (categoryDiff !== 0) return categoryDiff
          
          return (a.model_order_number ?? Number.MAX_SAFE_INTEGER) - 
                 (b.model_order_number ?? Number.MAX_SAFE_INTEGER)
        })
        
        return {
          id: sortedModels[0].id,
          engine: 'jan'
        }
      }
    }
  } catch (error) {
    console.warn('Failed to get default model from storage:', error)
  }
  
  // Fallback
  return {
    id: 'jan-v1-4b',
    engine: 'jan'
  }
}

export class ObjectParser {
  static threadToConversation(thread: Thread): Conversation {
    const modelName = thread.assistants?.[0]?.model?.id || undefined
    const modelProvider = thread.assistants?.[0]?.model?.engine || undefined
    const isFavorite = thread.metadata?.is_favorite?.toString() || 'false'
    const projectId = (thread.metadata?.project as { id?: string })?.id || undefined
    let metadata: ConversationMetadata = {}
    if (modelName && modelProvider) {
      metadata = {
        model_id: modelName,
        model_provider: modelProvider,
        is_favorite: isFavorite,
      }
    }
    return {
      title: shortenConversationTitle(thread.title),
      project_id: projectId,
      metadata,
    }
  }

  static conversationToThread(conversation: ConversationResponse): Thread {
    const assistants: ThreadAssistantInfo[] = []
    const metadata: ConversationMetadata = conversation.metadata || {}

    if (metadata.model_id && metadata.model_provider) {
      assistants.push({
        ...DEFAULT_ASSISTANT,
        model: {
          id: metadata.model_id,
          engine: metadata.model_provider,
        },
      })
    } else {
      // Get default model with lowest category_order_number and model_order_number
      const defaultModel = getDefaultModelIdFromStorage()
      assistants.push({
        ...DEFAULT_ASSISTANT,
        model: {
          id: defaultModel.id,
          engine: defaultModel.engine,
        },
      })
    }

    const isFavorite = metadata.is_favorite === 'true'
    const createdAtMs = parseTimestamp(conversation.created_at)

    return {
      id: conversation.id,
      title: conversation.title || '',
      assistants,
      created: createdAtMs,
      updated: createdAtMs,
      model: {
        id: metadata.model_id,
        provider: metadata.model_provider,
      },
      isFavorite,
      metadata: { is_favorite: isFavorite },
      project_id: conversation.project_id, // Map project_id from API response
    } as unknown as Thread
  }

  static conversationItemToThreadMessage(
    item: ConversationItem,
    threadId: string
  ): ThreadMessage {
    // Extract text content and metadata from the item
    const textSegments: string[] = []
    const reasoningSegments: string[] = []
    const imageUrls: string[] = []
    let toolCalls: any[] = []

    // Check for item-level tool_calls first (new backend format)
    if (item.tool_calls && Array.isArray(item.tool_calls)) {
      toolCalls = item.tool_calls.map((toolCall) => {
        const callId = toolCall.id || 'unknown'
        const rawArgs = toolCall.function?.arguments
        const normalizedArgs =
          typeof rawArgs === 'string'
            ? rawArgs
            : JSON.stringify(rawArgs ?? {})
        return {
          id: callId,
          tool_call_id: callId,
          tool: {
            id: callId,
            function: {
              name: toolCall.function?.name || 'unknown',
              arguments: normalizedArgs,
            },
            type: toolCall.type || 'function',
          },
          response: {
            error: '',
            content: [],
          },
          state: 'pending',
        }
      })
    }

    if (item.content && item.content.length > 0) {
      for (const content of item.content) {
        extractContentByType(content, {
          onText: (value) => {
            if (value) {
              textSegments.push(value)
            }
          },
          onReasoning: (value) => {
            if (value) {
              reasoningSegments.push(value)
            }
          },
          onImage: (url) => {
            if (url) {
              imageUrls.push(url)
            }
          },
          onToolCalls: (calls) => {
            // Only use content-level tool_calls if we don't already have item-level ones
            if (toolCalls.length === 0) {
              toolCalls = calls.map((toolCall) => {
                const callId = toolCall.id || 'unknown'
                const rawArgs = toolCall.function?.arguments
                const normalizedArgs =
                  typeof rawArgs === 'string'
                    ? rawArgs
                    : JSON.stringify(rawArgs ?? {})
                return {
                  id: callId,
                  tool_call_id: callId,
                  tool: {
                    id: callId,
                    function: {
                      name: toolCall.function?.name || 'unknown',
                      arguments: normalizedArgs,
                    },
                    type: toolCall.type || 'function',
                  },
                  response: {
                    error: '',
                    content: [],
                  },
                  state: 'pending',
                }
              })
            }
          },
        })
      }
    }

    // Format final content with reasoning if present
    let finalTextValue = ''
    if (reasoningSegments.length > 0) {
      finalTextValue += `<think>${reasoningSegments.join('\n')}</think>`
    }
    if (textSegments.length > 0) {
      if (finalTextValue) {
        finalTextValue += '\n'
      }
      finalTextValue += textSegments.join('\n')
    }
    if (!finalTextValue) {
      finalTextValue =
        item.content && item.content.length > 0
          ? JSON.stringify(item.content)
          : '(no content)'
    }

    // Build content array for ThreadMessage
    const messageContent: any[] = [
      {
        type: ContentType.Text,
        text: {
          value: finalTextValue || '',
          annotations: [],
        },
      },
    ]

    // Add image content if present
    for (const imageUrl of imageUrls) {
      messageContent.push({
        type: 'image_url' as ContentType,
        image_url: {
          url: imageUrl,
        },
      })
    }

    // Build metadata
    const metadata: any = { ...(item.metadata || {}) }
    if (toolCalls.length > 0) {
      metadata.tool_calls = toolCalls
    }

    const createdAtMs = parseTimestamp(item.created_at)

    // Map status from server format to frontend format
    const mappedStatus = item.status === 'completed' ? 'ready' : item.status || 'ready'

    const role = item.role === 'user' || item.role === 'assistant' ? item.role : 'assistant'

    return {
      type: 'text',
      id: item.id,
      object: 'thread.message',
      thread_id: threadId,
      role,
      content: messageContent,
      created_at: createdAtMs,
      completed_at: 0,
      status: mappedStatus,
      metadata,
    } as ThreadMessage
  }
}

const shortenConversationTitle = (title: string): string => {
  const maxLength = 50
  return title.length <= maxLength ? title : title.substring(0, maxLength)
}

export const getDefaultAssistant = (
  assistant: ThreadAssistantInfo
): ThreadAssistantInfo => {
  return { ...assistant, instructions: undefined }
}

/**
 * Utility function to combine conversation items into thread messages
 * Handles tool response merging and message consolidation
 */
export const combineConversationItemsToMessages = (
  items: ConversationItem[],
  threadId: string
): ThreadMessage[] => {
  const messages: ThreadMessage[] = []
  const toolResponseMap = new Map<string, any>()
  const sortedItems = [...items].sort(
    (a, b) => parseTimestamp(a.created_at) - parseTimestamp(b.created_at)
  )

  // First pass: collect tool responses
  for (const item of sortedItems) {
    if (item.role === 'tool') {
      // Try to get tool_call_id from the item level first (new backend format)
      // or fall back to content level for backward compatibility
      const itemLevelToolCallId = item.tool_call_id
      
      for (const content of item.content ?? []) {
        const toolCallId = itemLevelToolCallId || content.tool_call_id || item.id
        const toolResultText =
          content.tool_result?.output_text?.text ||
          (Array.isArray(content.tool_result?.content)
            ? content.tool_result?.content
                ?.map((entry) => entry.text || entry.output_text?.text)
                .filter((text): text is string => Boolean(text))
                .join('\n')
            : undefined)
        const toolContent =
          (typeof content.text === 'string'
            ? content.text
            : content.text?.text || content.text?.value) ||
          content.output_text?.text ||
          content.input_text ||
          content.text_result ||
          toolResultText ||
          JSON.stringify(content)
        toolResponseMap.set(toolCallId, {
          error: '',
          content: [
            {
              type: 'text',
              text: toolContent,
            },
          ],
        })
      }
    }
  }

  // Second pass: build messages and merge tool responses
  for (const item of sortedItems) {
    // Skip tool messages as they will be merged into assistant messages
    if (item.role === 'tool') {
      continue
    }

    const message = ObjectParser.conversationItemToThreadMessage(item, threadId)

    // If this is an assistant message with tool calls, merge tool responses
    if (
      message.role === 'assistant' &&
      message.metadata?.tool_calls &&
      Array.isArray(message.metadata.tool_calls)
    ) {
      const toolCalls = message.metadata.tool_calls as any[]

      for (const toolCall of toolCalls) {
        const callId = toolCall.tool_call_id || toolCall.id || toolCall.tool?.id
        let responseKey: string | undefined
        let response: any = null

        if (callId && toolResponseMap.has(callId)) {
          responseKey = callId
          response = toolResponseMap.get(callId)
        } else {
          const iterator = toolResponseMap.entries().next()
          if (!iterator.done) {
            responseKey = iterator.value[0]
            response = iterator.value[1]
          }
        }

        if (response) {
          toolCall.response = response
          toolCall.state = 'succeeded'
          if (responseKey) {
            toolResponseMap.delete(responseKey)
          }
        }
      }
    }

    messages.push(message)
  }

  return messages
}

const parseTimestamp = (value: number | string | undefined): number => {
  if (typeof value === 'number') {
    // Distinguish between seconds and milliseconds
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}

const extractContentByType = (
  content: ConversationItemContent,
  handlers: {
    onText: (value: string) => void
    onReasoning: (value: string) => void
    onImage: (url: string) => void
    onToolCalls: (calls: NonNullable<ConversationItemContent['tool_calls']>) => void
  }
) => {
  const type = content.type || ''

  switch (type) {
    case 'input_text':
      {
        const textValue =
          content.input_text ||
          (typeof content.text === 'string'
            ? content.text
            : content.text?.text || content.text?.value) ||
          ''
        handlers.onText(textValue)
      }
      break
    case 'text':
      {
        const textValue =
          typeof content.text === 'string'
            ? content.text
            : content.text?.text || content.text?.value || ''
        handlers.onText(textValue || '')
      }
      break
    case 'output_text':
      handlers.onText(content.output_text?.text || '')
      break
    case 'reasoning_content':
      handlers.onReasoning(content.reasoning_content || '')
      break
    case 'reasoning_text':
      {
        const reasoningValue =
          typeof content.text === 'string'
            ? content.text
            : content.reasoning_content || content.text?.text || content.text?.value || ''
        handlers.onReasoning(reasoningValue || '')
      }
      break
    case 'image':
    case 'image_url':
      if (content.image?.url) {
        handlers.onImage(content.image.url)
      }
      break
    case 'tool_calls':
      if (content.tool_calls && Array.isArray(content.tool_calls)) {
        handlers.onToolCalls(content.tool_calls)
      }
      break
    case 'tool_result':
      if (content.tool_result?.output_text?.text) {
        handlers.onText(content.tool_result.output_text.text)
      }
      break
    default:
      // Fallback for legacy fields without explicit type
      const fallbackText =
        typeof content.text === 'string'
          ? content.text
          : content.text?.value || content.text?.text
      if (fallbackText) {
        handlers.onText(fallbackText)
      }
      if (content.text_result) {
        handlers.onText(content.text_result)
      }
      if (content.output_text?.text) {
        handlers.onText(content.output_text.text)
      }
      if (content.reasoning_content) {
        handlers.onReasoning(content.reasoning_content)
      }
      if (content.image?.url) {
        handlers.onImage(content.image.url)
      }
      if (content.tool_calls && Array.isArray(content.tool_calls)) {
        handlers.onToolCalls(content.tool_calls)
      }
      break
  }
}
