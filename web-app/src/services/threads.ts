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
            updated: e.updated ?? 0,
            order: e.metadata?.order,
            isFavorite: e.metadata?.is_favorite,
            model: {
              id: e.assistants?.[0]?.model?.id,
              provider: e.assistants?.[0]?.model?.engine,
            },
            assistants: e.assistants?.map((assistant) => ({
              id: assistant.assistant_id,
              name: assistant.assistant_name,
              model: {
                id: assistant.model?.id,
                provider: assistant.model?.engine,
              },
              description: '',
              icon: '',
              instructions: assistant.instructions,
              created_at: Date.now(),
              parameters: {},
            })) ?? [defaultAssistant],
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
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'llama.cpp',
            },
            assistant_id: 'jan',
            assistant_name: 'Jan',
          },
        ],
        metadata: {
          order: 1,
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
          order: 1,
          assistants: e.assistants?.map((assistant) => ({
            id: assistant.assistant_id,
            name: assistant.assistant_name,
            model: {
              id: assistant.model?.id,
              provider: assistant.model?.engine,
            },
            description: '',
            icon: '',
            instructions: assistant.instructions,
            created_at: Date.now(),
            parameters: {},
          })) ?? [defaultAssistant],
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
            engine: thread.model?.provider ?? 'llama.cpp',
          },
          assistant_id: e.id ?? e.assistant_id,
          assistant_name: e.name ?? e.assistant_name,
          instructions: e.instructions,
        }
      }) ?? [
        {
          model: {
            id: thread.model?.id ?? '*',
            engine: thread.model?.provider ?? 'llama.cpp',
          },
          assistant_id: 'jan',
          assistant_name: 'Jan',
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
