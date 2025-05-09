import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { mockTheads } from '@/mock/data'

type ThreadState = {
  threads: Record<string, Thread>
  deletedThreadIds: string[]
  streamingContent?: ThreadContent
  currentThreadId?: string
  setThreads: (threads: Thread[]) => void
  fetchThreads: () => Promise<void>
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  deleteAllThreads: () => void
  unstarAllThreads: () => void
  addThreadContent: (threadId: string, content: ThreadContent) => void
  updateThreadContents: (threadId: string, contents: ThreadContent[]) => void
  updateStreamingContent: (content: ThreadContent | undefined) => void
  setCurrentThreadId: (threadId: string) => void
}

export const useThreads = create<ThreadState>()(
  persist(
    (set, get) => ({
      threads: {},
      deletedThreadIds: [],
      setThreads: (threads) => {
        const threadMap = threads.reduce(
          (acc, thread) => {
            acc[thread.id] = thread
            return acc
          },
          {} as Record<string, Thread>
        )
        set({ threads: threadMap })
      },
      toggleFavorite: (threadId) => {
        set((state) => ({
          threads: {
            ...state.threads,
            [threadId]: {
              ...state.threads[threadId],
              isFavorite: !state.threads[threadId].isFavorite,
            },
          },
        }))
      },
      deleteThread: (threadId) => {
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [threadId]: _, ...remainingThreads } = state.threads
          return {
            threads: remainingThreads,
            deletedThreadIds: [...state.deletedThreadIds, threadId],
          }
        })
      },
      deleteAllThreads: () => {
        set((state) => {
          const allThreadIds = Object.keys(state.threads)
          return {
            threads: {},
            deletedThreadIds: [...state.deletedThreadIds, ...allThreadIds],
          }
        })
      },
      unstarAllThreads: () => {
        set((state) => {
          const updatedThreads = Object.keys(state.threads).reduce(
            (acc, threadId) => {
              acc[threadId] = {
                ...state.threads[threadId],
                isFavorite: false,
              }
              return acc
            },
            {} as Record<string, Thread>
          )
          return { threads: updatedThreads }
        })
      },
      getFavoriteThreads: () => {
        return Object.values(get().threads).filter(
          (thread) => thread.isFavorite
        )
      },
      getThreadById: (threadId: string) => {
        return get().threads[threadId]
      },
      fetchThreads: async () => {
        const response = await new Promise<Thread[]>((resolve) =>
          setTimeout(() => resolve(mockTheads as Thread[]), 0)
        )

        set((state) => {
          const filteredResponse = response.filter(
            (thread) => !state.deletedThreadIds.includes(thread.id)
          )

          const existingIds = new Set(Object.keys(state.threads))
          const newThreads = filteredResponse.filter(
            (t) => !existingIds.has(t.id)
          )

          const newThreadMap = newThreads.reduce(
            (acc, thread) => {
              acc[thread.id] = thread
              return acc
            },
            {} as Record<string, Thread>
          )

          return {
            threads: { ...state.threads, ...newThreadMap },
          }
        })
      },
      addThreadContent: (threadId, content) => {
        set((state) => ({
          threads: {
            ...state.threads,
            [threadId]: {
              ...state.threads[threadId],
              content: [...(state.threads[threadId].content || []), content],
            },
          },
        }))
      },
      updateThreadContents: (threadId, contents) => {
        set((state) => ({
          threads: {
            ...state.threads,
            [threadId]: {
              ...state.threads[threadId],
              content: contents,
            },
          },
        }))
      },
      updateStreamingContent: (content) => {
        set({ streamingContent: content })
      },
      setCurrentThreadId: (threadId) => {
        set({ currentThreadId: threadId })
      },
    }),
    {
      name: localStoregeKey.threads,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
