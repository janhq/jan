/**
 * Default Threads Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@janhq/core'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

export class DefaultThreadsService implements ThreadsService {
  async fetchThreads(): Promise<Thread[]> {
    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.listThreads()
        .then((threads) => {
          if (!Array.isArray(threads)) return []

          // Filter out temporary threads from the list
          const filteredThreads = threads.filter(
            (e) => e.id !== TEMPORARY_CHAT_ID
          )

          return filteredThreads.map((e) => {
            // Model is always stored in assistants[0].model
            const model = e.assistants?.[0]?.model
              ? {
                  id: e.assistants[0].model.id,
                  provider: e.assistants[0].model.engine,
                }
              : undefined

            // Check if this is a "real" assistant (has instructions) or just model storage
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
    const assistantsPayload = hasRealAssistant
      ? [
          {
            ...thread.assistants![0],
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'llamacpp',
            },
          },
        ]
      : [
          {
            // Minimal entry just to store model info
            id: 'model-only',
            name: 'Model',
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'llamacpp',
            },
          },
        ]

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
          // Model is always stored in assistants[0].model
          const model = e.assistants?.[0]?.model
            ? {
                id: e.assistants[0].model.id,
                provider: e.assistants[0].model.engine,
              }
            : thread.model

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
        assistants: thread.assistants?.map((e) => {
          return {
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'llamacpp',
            },
            id: e.id,
            name: e.name,
            instructions: e.instructions,
          }
        }) ?? [
          {
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'llamacpp',
            },
            id: 'jan',
            name: 'Jan',
          },
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
