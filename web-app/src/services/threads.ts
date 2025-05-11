import { ExtensionManager } from '@/lib/extension'
import {
  ConversationalExtension,
  ExtensionTypeEnum,
  InferenceEngine,
} from '@janhq/core'

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
            content: [],
            createdAt: new Date(e.created),
            updatedAt: new Date(e.updated),
            model: {
              id: e.assistants?.[0]?.model.id,
              provider: e.assistants?.[0]?.model.engine,
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
              engine: (thread.model?.provider ??
                'llama.cpp') as InferenceEngine,
            },
            assistant_id: 'jan',
            assistant_name: 'Jan',
          },
        ],
      })
      .then((e) => {
        return {
          ...e,
          content: [],
          createdAt: new Date(e.created),
          updatedAt: new Date(e.updated),
          model: {
            id: e.assistants?.[0]?.model.id,
            provider: e.assistants?.[0]?.model.engine,
          },
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
      assistants: [
        {
          model: {
            id: thread.model?.id ?? '*',
            engine: (thread.model?.provider ?? 'llama.cpp') as InferenceEngine,
          },
          assistant_id: 'jan',
          assistant_name: 'Jan',
        },
      ],
      object: 'thread',
      created: Date.now(),
      updated: Date.now(),
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
