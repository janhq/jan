import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { mockTheads } from '@/mock/data'
import { models, TokenJS } from 'token.js'
import { newAssistantThreadContent } from '@/helpers/threads'

type ThreadState = {
  threads: Thread[]
  deletedThreadIds: string[]
  setThreads: (threads: Thread[]) => void
  fetchThreads: () => Promise<void>
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  deleteAllThreads: () => void
  unstarAllThreads: () => void
  addThreadContent: (threadId: string, content: ThreadContent) => void
  sendCompletion: (
    provider: ModelProvider | undefined,
    threadId: string,
    content: string
  ) => Promise<void>
}

export const useThreads = create<ThreadState>()(
  persist(
    (set, get) => ({
      threads: [],
      deletedThreadIds: [],
      setThreads: (threads) => set({ threads }),
      toggleFavorite: (threadId) => {
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? { ...thread, isFavorite: !thread.isFavorite }
              : thread
          ),
        }))
      },
      deleteThread: (threadId) => {
        set((state) => ({
          threads: state.threads.filter((thread) => thread.id !== threadId),
          deletedThreadIds: [...state.deletedThreadIds, threadId],
        }))
      },
      deleteAllThreads: () => {
        set((state) => {
          const allThreadIds = state.threads.map((thread) => thread.id)
          return {
            threads: [],
            deletedThreadIds: [...state.deletedThreadIds, ...allThreadIds],
          }
        })
      },
      unstarAllThreads: () => {
        set((state) => ({
          threads: state.threads.map((thread) => ({
            ...thread,
            isFavorite: false,
          })),
        }))
      },
      getFavoriteThreads: () => {
        return get().threads.filter((thread) => thread.isFavorite)
      },
      getThreadById: (threadId: string) => {
        return get().threads.find((thread) => thread.id === threadId)
      },
      fetchThreads: async () => {
        const response = await new Promise<Thread[]>((resolve) =>
          setTimeout(() => resolve(mockTheads as Thread[]), 0)
        )

        set((state) => {
          // Filter out deleted threads from the response
          const filteredResponse = response.filter(
            (thread) => !state.deletedThreadIds.includes(thread.id)
          )

          const localIds = state.threads.map((t) => t.id)
          const responseIds = filteredResponse.map((t) => t.id)

          const isSame =
            localIds.length === responseIds.length &&
            localIds.every((id) => responseIds.includes(id))

          if (isSame) {
            return {}
          }

          const existingIds = new Set(localIds)
          const newThreads = filteredResponse.filter(
            (t) => !existingIds.has(t.id)
          )

          return {
            threads: [...newThreads, ...state.threads],
          }
        })
      },
      addThreadContent: (threadId, content) => {
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  content: [...(thread.content || []), content],
                }
              : thread
          ),
        }))
      },
      sendCompletion: async (
        provider: ModelProvider | undefined,
        threadId: string,
        content: string
      ): Promise<void> => {
        const thread = get().threads.find((t) => t.id === threadId)

        if (!thread?.model?.id || !provider || !provider.api_key) return

        let providerName = provider.provider as unknown as keyof typeof models

        if (!Object.keys(models).some((key) => key === providerName))
          // Check if the provider is valid
          providerName = 'openai-compatible'

        const tokenJS = new TokenJS({
          apiKey: provider.api_key,
          baseURL: provider.base_url,
        })

        const completion = await tokenJS.chat.completions.create({
          stream: true,
          provider: providerName,
          model: thread.model?.id,
          messages: [
            {
              role: 'user',
              content,
            },
          ],
        })
        const newContent = newAssistantThreadContent('')
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  content: [...(thread.content || []), newContent],
                }
              : thread
          ),
        }))
        for await (const part of completion) {
          newContent.text!.value += part.choices[0]?.delta?.content || ''
            set((state) => ({
            threads: state.threads.map((thread) =>
              thread.id === threadId
              ? {
                ...thread,
                content: [
                  ...(thread.content?.slice(0, -1) || []),
                  newContent,
                ],
                }
              : thread
            ),
            }))
        }
      },
    }),
    {
      name: localStoregeKey.threads,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
