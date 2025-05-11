import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { ulid } from 'ulidx'
import { ThreadMessage } from '@janhq/core'
import { createThread, deleteThread, updateThread } from '@/services/threads'

type ThreadState = {
  threads: Record<string, Thread>
  deletedThreadIds: string[]
  streamingContent?: ThreadMessage
  currentThreadId?: string
  getCurrentThread: () => Thread | undefined
  setThreads: (threads: Thread[]) => void
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  deleteAllThreads: () => void
  unstarAllThreads: () => void
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  setCurrentThreadId: (threadId?: string) => void
  createThread: (model: ThreadModel) => Thread
  updateCurrentThreadModel: (model: ThreadModel) => void
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
          deleteThread(threadId)
          return {
            threads: remainingThreads,
            deletedThreadIds: [...state.deletedThreadIds, threadId],
          }
        })
      },
      deleteAllThreads: () => {
        set((state) => {
          const allThreadIds = Object.keys(state.threads)
          allThreadIds.forEach((threadId) => {
            deleteThread(threadId)
          })
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
      updateStreamingContent: (content) => {
        set({ streamingContent: content })
      },
      setCurrentThreadId: (threadId) => {
        set({ currentThreadId: threadId })
      },
      createThread: (model) => {
        const newThread: Thread = {
          id: ulid(),
          title: 'New Thread',
          content: [],
          model,
          isFavorite: false,
        }
        createThread(newThread).then((createdThread) => {
          set((state) => ({
            threads: {
              ...state.threads,
              [createdThread.id]: createdThread,
            },
            currentThreadId: createdThread.id,
          }))
        })

        return newThread
      },
      updateCurrentThreadModel: (model) => {
        set((state) => {
          const currentThread = state.getCurrentThread()
          if (currentThread) updateThread({ ...currentThread, model })
          return {
            threads: {
              ...state.threads,
              [state.currentThreadId as string]: {
                ...state.threads[state.currentThreadId as string],
                model,
              },
            },
          }
        })
      },
      getCurrentThread: () => {
        const { currentThreadId, threads } = get()
        return currentThreadId ? threads[currentThreadId] : undefined
      },
    }),
    {
      name: localStoregeKey.threads,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
