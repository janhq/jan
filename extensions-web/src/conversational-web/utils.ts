import { Thread, ThreadAssistantInfo } from '@janhq/core'
import { Conversation, ConversationResponse } from './types'
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
