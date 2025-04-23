import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

type ThreadState = {
  threads: Thread[]
  deletedThreadIds: string[]
  setThreads: (threads: Thread[]) => void
  fetchThreads: () => Promise<void>
  getFavoriteThreads: () => Thread[]
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
      fetchThreads: async () => {
        const response = await new Promise<Thread[]>((resolve) =>
          setTimeout(
            () =>
              resolve([
                {
                  id: '1',
                  title: 'Understanding Async in JavaScript',
                  isFavorite: false,
                },
                {
                  id: '2',
                  title: 'Best Practices for Clean React Architecture',
                  isFavorite: false,
                },
                {
                  id: '3',
                  title: 'New Conversation from Another Tab',
                  isFavorite: false,
                },
                {
                  id: '4',
                  title: 'Using Zustand for State Management',
                  isFavorite: false,
                },
                {
                  id: '5',
                  title: 'Exploring the New React Features',
                  isFavorite: false,
                },
                { id: '6', title: 'What’s New in ES2023', isFavorite: false },
                {
                  id: '7',
                  title: 'How to Optimize React Performance',
                  isFavorite: false,
                },
                {
                  id: '8',
                  title: 'Building a Chat App with Socket.io',
                  isFavorite: true,
                },
                {
                  id: '9',
                  title: 'Understanding JavaScript Closures',
                  isFavorite: true,
                },
                {
                  id: '10',
                  title: 'Mastering TypeScript Generics',
                  isFavorite: true,
                },
              ]),
            0
          )
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
