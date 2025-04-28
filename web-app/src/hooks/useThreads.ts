import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { mockTheads } from '@/mock/data'

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
    }),
    {
      name: localStoregeKey.threads,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
