import { Thread, ThreadAssistantInfo, ThreadMessage, ContentType } from '@janhq/core'
import { Conversation, ConversationResponse, ConversationItem } from './types'
import { DEFAULT_ASSISTANT } from './const'

export class ObjectParser {
  static threadToConversation(thread: Thread): Conversation {
    const modelName = thread.assistants?.[0]?.model?.id || undefined
    const modelProvider = thread.assistants?.[0]?.model?.engine || undefined
    const isFavorite = thread.metadata?.is_favorite?.toString() || 'false'
    let metadata = {}
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
    if (
      conversation.metadata?.model_id &&
      conversation.metadata?.model_provider
    ) {
      assistants.push({
        ...DEFAULT_ASSISTANT,
        model: {
          id: conversation.metadata.model_id,
          engine: conversation.metadata.model_provider,
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

    const isFavorite = conversation.metadata?.is_favorite === 'true'
    return {
      id: conversation.id,
      title: conversation.title || '',
      assistants,
      created: conversation.created_at,
      updated: conversation.created_at,
      model: {
        id: conversation.metadata.model_id,
        provider: conversation.metadata.model_provider,
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
    let textContent = ''
    let reasoningContent = ''
    const imageUrls: string[] = []
    let toolCalls: any[] = []
    let finishReason = ''

    if (item.content && item.content.length > 0) {
      for (const content of item.content) {
        // Handle text content
        if (content.text?.value) {
          textContent = content.text.value
        }
        // Handle output_text for assistant messages
        if (content.output_text?.text) {
          textContent = content.output_text.text
        }
        // Handle reasoning content
        if (content.reasoning_content) {
          reasoningContent = content.reasoning_content
        }
        // Handle image content
        if (content.image?.url) {
          imageUrls.push(content.image.url)
        }
        // Extract finish_reason
        if (content.finish_reason) {
          finishReason = content.finish_reason
        }
      }
    }

    // Handle tool calls parsing for assistant messages
    if (item.role === 'assistant' && finishReason === 'tool_calls') {
      try {
        // Tool calls are embedded as JSON string in textContent
        const toolCallMatch = textContent.match(/\[.*\]/)
        if (toolCallMatch) {
          const toolCallsData = JSON.parse(toolCallMatch[0])
          toolCalls = toolCallsData.map((toolCall: any) => ({
            tool: {
              id: toolCall.id || 'unknown',
              function: {
                name: toolCall.function?.name || 'unknown',
                arguments: toolCall.function?.arguments || '{}'
              },
              type: toolCall.type || 'function'
            },
            response: {
              error: '',
              content: []
            },
            state: 'ready'
          }))
          // Remove tool calls JSON from text content, keep only reasoning
          textContent = ''
        }
      } catch (error) {
        console.error('Failed to parse tool calls:', error)
      }
    }

    // Format final content with reasoning if present
    let finalTextValue = ''
    if (reasoningContent) {
      finalTextValue = `<think>${reasoningContent}</think>`
    }
    if (textContent) {
      finalTextValue += textContent
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
    const metadata: any = {}
    if (toolCalls.length > 0) {
      metadata.tool_calls = toolCalls
    }

    // Map status from server format to frontend format
    const mappedStatus = item.status === 'completed' ? 'ready' : item.status || 'ready'

    return {
      type: 'text',
      id: item.id,
      object: 'thread.message',
      thread_id: threadId,
      role: item.role as 'user' | 'assistant',
      content: messageContent,
      created_at: item.created_at * 1000, // Convert to milliseconds
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

  // First pass: collect tool responses
  for (const item of items) {
    if (item.role === 'tool') {
      const toolContent = item.content?.[0]?.text?.value || ''
      toolResponseMap.set(item.id, {
        error: '',
        content: [
          {
            type: 'text',
            text: toolContent
          }
        ]
      })
    }
  }

  // Second pass: build messages and merge tool responses
  for (const item of items) {
    // Skip tool messages as they will be merged into assistant messages
    if (item.role === 'tool') {
      continue
    }

    const message = ObjectParser.conversationItemToThreadMessage(item, threadId)

    // If this is an assistant message with tool calls, merge tool responses
    if (message.role === 'assistant' && message.metadata?.tool_calls && Array.isArray(message.metadata.tool_calls)) {
      const toolCalls = message.metadata.tool_calls as any[]
      let toolResponseIndex = 0

      for (const [responseId, responseData] of toolResponseMap.entries()) {
        if (toolResponseIndex < toolCalls.length) {
          toolCalls[toolResponseIndex].response = responseData
          toolResponseIndex++
        }
      }
    }

    messages.push(message)
  }

  return messages
}
