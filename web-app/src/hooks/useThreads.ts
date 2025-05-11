import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { ulid } from 'ulidx'
import { createThread, deleteThread, updateThread } from '@/services/threads'
import Fuse from 'fuse.js'
type ThreadState = {
  threads: Record<string, Thread>
  currentThreadId?: string
  getCurrentThread: () => Thread | undefined
  setThreads: (threads: Thread[]) => void
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  deleteAllThreads: () => void
  unstarAllThreads: () => void
  setCurrentThreadId: (threadId?: string) => void
  createThread: (model: ThreadModel, title?: string) => Promise<Thread>
  updateCurrentThreadModel: (model: ThreadModel) => void
  getFilteredThreads: (searchTerm: string) => Thread[]
  searchIndex: Fuse<Thread> | null
}

const fuseOptions = {
  keys: ['title'],
  threshold: 0.2,
  includeMatches: true,
  ignoreLocation: true, // Ignore the location of the match in the string
  useExtendedSearch: true, // Enable extended search
  distance: 20, // Maximum edit distance for fuzzy matching
  tokenize: true, // Tokenize the search pattern and text
  matchAllTokens: true, // Only require some tokens to match, not all
  findAllMatches: true, // Find all matches, not just the first one,
}

export const useThreads = create<ThreadState>()(
  persist(
    (set, get) => ({
      threads: {},
      searchIndex: null,
      setThreads: (threads) => {
        threads.forEach((thread, index) => {
          thread.order = index + 1
          updateThread({
            ...thread,
            order: index + 1,
          })
        })
        const threadMap = threads.reduce(
          (acc, thread) => {
            acc[thread.id] = thread
            return acc
          },
          {} as Record<string, Thread>
        )
        set({ threads: threadMap })
      },
      getFilteredThreads: (searchTerm: string) => {
        const { threads, searchIndex } = get()

        // If no search term, return all threads
        if (!searchTerm) {
          // return all threads
          return Object.values(threads)
        }

        // Get current search index or create a new one if it doesn't exist
        const currentIndex =
          searchIndex ||
          (() => {
            const newIndex = new Fuse(Object.values(threads), fuseOptions)
            // Update the store with the new index
            set({ searchIndex: newIndex })
            return newIndex
          })()

        // Use the index to search and return matching threads
        const searchResults = currentIndex.search(searchTerm)
        const validIds = searchResults.map((result) => result.item.id)
        return Object.values(get().threads).filter((thread) =>
          validIds.includes(thread.id)
        )
      },
      toggleFavorite: (threadId) => {
        set((state) => {
          updateThread({
            ...state.threads[threadId],
            isFavorite: !state.threads[threadId].isFavorite,
          })
          return {
            threads: {
              ...state.threads,
              [threadId]: {
                ...state.threads[threadId],
                isFavorite: !state.threads[threadId].isFavorite,
              },
            },
          }
        })
      },
      deleteThread: (threadId) => {
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [threadId]: _, ...remainingThreads } = state.threads
          deleteThread(threadId)
          return {
            threads: remainingThreads,
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
          Object.values(updatedThreads).forEach((thread) => {
            updateThread({ ...thread, isFavorite: false })
          })
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
      setCurrentThreadId: (threadId) => {
        set({ currentThreadId: threadId })
      },
      createThread: async (model, title) => {
        const newThread: Thread = {
          id: ulid(),
          title: title ?? 'New Thread',
          model,
          order: 1,
          updated: Date.now() / 1000,
        }
        return await createThread(newThread).then((createdThread) => {
          set((state) => ({
            threads: {
              ...state.threads,
              [createdThread.id]: createdThread,
            },
            currentThreadId: createdThread.id,
          }))
          return createdThread
        })
      },
      updateCurrentThreadModel: (model) => {
        set((state) => {
          if (!state.currentThreadId) return { ...state }
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
