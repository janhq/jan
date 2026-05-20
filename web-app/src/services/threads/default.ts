/**
 * Default Threads Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@janhq/core'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

function toModelPayload(model?: Thread['model']) {
  return { id: model?.id ?? '*', engine: model?.provider ?? 'llamacpp' }
}

function fromModelResponse(
  assistantModel: { id: string; engine?: string } | undefined,
  fallback?: Thread['model']
): Thread['model'] | undefined {
  if (assistantModel) {
    return { id: assistantModel.id, provider: assistantModel.engine ?? 'llamacpp' }
  }
  return fallback
}

export class DefaultThreadsService implements ThreadsService {
  async fetchThreads(): Promise<Thread[]> {
    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.listThreads()
        .then((threads) => {
          if (!Array.isArray(threads)) return []

          // new String("id") !== "id"
          threads.forEach((e) => {
            e.id = e.id?.toString()
            e.assistants?.forEach((a) => {
              a.id = a.id?.toString()
              if (a.model) a.model.id = a.model.id?.toString()
            })
          })

          // Filter out temporary threads from the list
          const filteredThreads = threads.filter(
            (e) => e.id !== TEMPORARY_CHAT_ID
          )

          return filteredThreads.map((e) => {
            const model = fromModelResponse(e.assistants?.[0]?.model)
            const assistants = e.assistants

            return {
              ...e,
              updated:
                typeof e.updated === 'number' && e.updated > 1e12
                  ? Math.floor(e.updated / 1000)
                  : (e.updated ?? 0),
              order: e.metadata?.order,
              isFavorite: e.metadata?.is_favorite,
              model,
              assistants,
              metadata: {
                ...e.metadata,
                // Override extracted fields to avoid duplication
                order: e.metadata?.order,
                is_favorite: e.metadata?.is_favorite,
              },
            } as Thread
          })
        })
        ?.catch((e) => {
          console.error('Error fetching threads:', e)
          return []
        }) ?? []
    )
  }

  async createThread(thread: Thread): Promise<Thread> {
    // For temporary threads, bypass the conversational extension (in-memory only)
    if (thread.id === TEMPORARY_CHAT_ID) {
      return thread
    }

    // Build assistants payload - always include model info
    // If there's a real assistant (with instructions), include full assistant data
    // Otherwise, just include minimal model-only entry for storage
    const hasRealAssistant = thread.assistants && thread.assistants.length > 0
    const modelPayload = toModelPayload(thread.model)
    const assistantsPayload = hasRealAssistant
      ? [{ ...thread.assistants![0], model: modelPayload }]
      : [{ id: 'model-only', name: 'Model', model: modelPayload }]

    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.createThread({
          ...thread,
          assistants: assistantsPayload,
          metadata: {
            ...thread.metadata,
            order: thread.order,
          },
        })
        .then((e) => {
          const model = fromModelResponse(e.assistants?.[0]?.model, thread.model)

          const assistants = e.assistants

          return {
            ...e,
            updated: e.updated,
            model,
            order: e.metadata?.order ?? thread.order,
            assistants,
          } as Thread
        })
        .catch(() => thread) ?? thread
    )
  }

  async updateThread(thread: Thread): Promise<void> {
    // For temporary threads, skip updating via conversational extension
    if (thread.id === TEMPORARY_CHAT_ID) {
      return
    }

    await ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.modifyThread({
        ...thread,
        assistants: thread.assistants?.map((e) => ({
          model: toModelPayload(thread.model),
          id: e.id,
          name: e.name,
          instructions: e.instructions,
        })) ?? [
          { model: toModelPayload(thread.model), id: 'jan', name: 'Jan' },
        ],
        metadata: {
          ...thread.metadata,
          is_favorite: thread.isFavorite,
          order: thread.order,
        },
        object: 'thread',
        created: Date.now() / 1000,
        updated: Date.now() / 1000,
      })
  }

  async deleteThread(threadId: string): Promise<void> {
    // For temporary threads, skip deleting via conversational extension
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.deleteThread(threadId)
  }
}
