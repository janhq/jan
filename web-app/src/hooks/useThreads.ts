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
  renameThread: (threadId: string, newTitle: string) => void
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
  threshold: 0.4, // Increased threshold to require more exact matches
  includeMatches: true, // Keeping this to show where matches occur
  ignoreLocation: true, // Consider the location of matches
  useExtendedSearch: true, // Disable extended search for more precise matching
  distance: 40, // Reduced edit distance for stricter fuzzy matching
  tokenize: false, // Keep tokenization for word-level matching
  matchAllTokens: true, // Require all tokens to match for better precision
  findAllMatches: false, // Only find the first match to reduce noise
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

        const currentIndex =
          searchIndex && searchIndex.search != undefined
            ? searchIndex
            : new Fuse(
                Object.values(threads).map((item) => item),
                fuseOptions
              )

        set({ searchIndex: currentIndex })

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
            searchIndex: new Fuse(Object.values(remainingThreads), fuseOptions),
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
        set((state) => ({
          searchIndex: new Fuse(Object.values(state.threads), fuseOptions),
        }))
        console.log('newThread', newThread)
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
      renameThread: (threadId, newTitle) => {
        set((state) => {
          const thread = state.threads[threadId]
          if (!thread) return state
          const updatedThread = {
            ...thread,
            title: newTitle,
          }
          updateThread(updatedThread)
          return {
            threads: {
              ...state.threads,
              [threadId]: updatedThread,
            },
            // Update search index with the new title
            searchIndex: new Fuse(
              Object.values({
                ...state.threads,
                [threadId]: updatedThread,
              }),
              fuseOptions
            ),
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
