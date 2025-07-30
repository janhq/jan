import { defaultAssistant } from '@/hooks/useAssistant'
import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@janhq/core'

/**
 * Fetches all threads from the conversational extension.
 * @returns {Promise<Thread[]>} A promise that resolves to an array of threads.
 */
export const fetchThreads = async (): Promise<Thread[]> => {
  return (
    ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.listThreads()
      .then((threads) => {
        if (!Array.isArray(threads)) return []

        return threads.map((e) => {
          return {
            ...e,
            updated:
              typeof e.updated === 'number' && e.updated > 1e12
                ? Math.floor(e.updated / 1000)
                : (e.updated ?? 0),
            order: e.metadata?.order,
            isFavorite: e.metadata?.is_favorite,
            model: {
              id: e.assistants?.[0]?.model?.id,
              provider: e.assistants?.[0]?.model?.engine,
            },
            assistants: e.assistants ?? [defaultAssistant],
          } as Thread
        })
      })
      ?.catch((e) => {
        console.error('Error fetching threads:', e)
        return []
      }) ?? []
  )
}

/**
 * Creates a new thread using the conversational extension.
 * @param thread - The thread object to create.
 * @returns {Promise<Thread>} A promise that resolves to the created thread.
 */
export const createThread = async (thread: Thread): Promise<Thread> => {
  return (
    ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.createThread({
        ...thread,
        assistants: [
          {
            ...(thread.assistants?.[0] ?? defaultAssistant),
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'llamacpp',
            },
          },
        ],
        metadata: {
          order: thread.order,
        },
      })
      .then((e) => {
        return {
          ...e,
          updated: e.updated,
          model: {
            id: e.assistants?.[0]?.model?.id,
            provider: e.assistants?.[0]?.model?.engine,
          },
          order: e.metadata?.order ?? thread.order,
          assistants: e.assistants ?? [defaultAssistant],
        } as Thread
      })
      .catch(() => thread) ?? thread
  )
}

/**
 * Updates an existing thread using the conversational extension.
 * @param thread - The thread object to update.
 */
export const updateThread = (thread: Thread) => {
  return ExtensionManager.getInstance()
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
        is_favorite: thread.isFavorite,
        order: thread.order,
      },
      object: 'thread',
      created: Date.now() / 1000,
      updated: Date.now() / 1000,
    })
}

/**
 * Deletes a thread using the conversational extension.
 * @param threadId - The ID of the thread to delete.
 * @returns
 */
export const deleteThread = (threadId: string) => {
  return ExtensionManager.getInstance()
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.deleteThread(threadId)
}
