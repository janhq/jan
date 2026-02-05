import { Thread, ThreadAssistantInfo, ThreadMessage, ContentType } from '@janhq/core'
import { Conversation, ConversationResponse, ConversationItem, ConversationItemContent, ConversationMetadata } from './types'
import { DEFAULT_ASSISTANT } from './const'

export class ObjectParser {
  static threadToConversation(thread: Thread): Conversation {
    const modelName = thread.assistants?.[0]?.model?.id || undefined
    const modelProvider = thread.assistants?.[0]?.model?.engine || undefined
    const isFavorite = thread.metadata?.is_favorite?.toString() || 'false'
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
      assistants.push({
        ...DEFAULT_ASSISTANT,
        model: {
          id: 'jan-v1-4b',
          engine: 'jan',
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
      for (const content of item.content ?? []) {
        const toolCallId = content.tool_call_id || item.id
        const toolResultText =
          content.tool_result?.output_text?.text ||
          (Array.isArray(content.tool_result?.content)
            ? content.tool_result?.content
                ?.map((entry) => entry.text || entry.output_text?.text)
                .filter((text): text is string => Boolean(text))
                .join('\n')
            : undefined)
        const toolContent =
          content.text?.text ||
          content.text?.value ||
          content.output_text?.text ||
          content.input_text ||
          content.text_result ||
          toolResultText ||
          ''
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
      handlers.onText(content.input_text || '')
      break
    case 'text':
      handlers.onText(content.text?.text || content.text?.value || '')
      break
    case 'output_text':
      handlers.onText(content.output_text?.text || '')
      break
    case 'reasoning_content':
      handlers.onReasoning(content.reasoning_content || '')
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
      if (content.text?.value || content.text?.text) {
        handlers.onText(content.text.value || content.text.text || '')
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
