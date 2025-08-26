import { create } from 'zustand'
import { ulid } from 'ulidx'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Fzf } from 'fzf'

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
  createThread: (
    model: ThreadModel,
    title?: string,
    assistant?: Assistant
  ) => Promise<Thread>
  updateCurrentThreadModel: (model: ThreadModel) => void
  getFilteredThreads: (searchTerm: string) => Thread[]
  updateCurrentThreadAssistant: (assistant: Assistant) => void
  updateThreadTimestamp: (threadId: string) => void
  searchIndex: Fzf<Thread[]> | null
}

export const useThreads = create<ThreadState>()((set, get) => ({
  threads: {},
  searchIndex: null,
  setThreads: (threads) => {
    const threadMap = threads.reduce(
      (acc: Record<string, Thread>, thread) => {
        acc[thread.id] = {
          ...thread,
          model: thread.model
            ? {
                provider: thread.model.provider.replace(
                  'llama.cpp',
                  'llamacpp'
                ),
                // Cortex migration: take first two parts of the ID (the last is file name which is not needed)
                id:
                  thread.model.provider === 'llama.cpp' ||
                  thread.model.provider === 'llamacpp'
                    ? thread.model?.id.split(':').slice(0, 2).join(getServiceHub().path().sep())
                    : thread.model?.id,
              }
            : undefined,
        }
        return acc
      },
      {} as Record<string, Thread>
    )
    set({
      threads: threadMap,
      searchIndex: new Fzf<Thread[]>(Object.values(threadMap), {
        selector: (item: Thread) => item.title,
      }),
    })
  },
  getFilteredThreads: (searchTerm: string) => {
    const { threads, searchIndex } = get()

    // If no search term, return all threads
    if (!searchTerm) {
      // return all threads
      return Object.values(threads)
    }

    let currentIndex = searchIndex
    if (!currentIndex?.find) {
      currentIndex = new Fzf<Thread[]>(Object.values(threads), {
        selector: (item: Thread) => item.title,
      })
      set({ searchIndex: currentIndex })
    }

    // Use the index to search and return matching threads
    const fzfResults = currentIndex.find(searchTerm)
    return fzfResults.map(
      (result: { item: Thread; positions: Set<number> }) => {
        const thread = result.item // Fzf stores the original item here

        return {
          ...thread,
          title: thread.title, // Override title with highlighted version
        }
      }
    )
  },
  toggleFavorite: (threadId) => {
    set((state) => {
      getServiceHub().threads().updateThread({
        ...state.threads[threadId],
        isFavorite: !state.threads[threadId].isFavorite,
      })
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...state.threads[threadId],
            isFavorite: !state.threads[threadId].isFavorite,
            updated: Date.now() / 1000,
          },
        },
      }
    })
  },
  deleteThread: (threadId) => {
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [threadId]: _, ...remainingThreads } = state.threads
      getServiceHub().threads().deleteThread(threadId)
      return {
        threads: remainingThreads,
        searchIndex: new Fzf<Thread[]>(Object.values(remainingThreads), {
          selector: (item: Thread) => item.title,
        }),
      }
    })
  },
  deleteAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)
      const favoriteThreadIds = allThreadIds.filter(
        (threadId) => state.threads[threadId].isFavorite
      )
      const nonFavoriteThreadIds = allThreadIds.filter(
        (threadId) => !state.threads[threadId].isFavorite
      )

      // Only delete non-favorite threads
      nonFavoriteThreadIds.forEach((threadId) => {
        getServiceHub().threads().deleteThread(threadId)
      })

      // Keep only favorite threads
      const remainingThreads = favoriteThreadIds.reduce(
        (acc, threadId) => {
          acc[threadId] = state.threads[threadId]
          return acc
        },
        {} as Record<string, Thread>
      )

      return {
        threads: remainingThreads,
        searchIndex: new Fzf<Thread[]>(Object.values(remainingThreads), {
          selector: (item: Thread) => item.title,
        }),
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
        getServiceHub().threads().updateThread({ ...thread, isFavorite: false })
      })
      return { threads: updatedThreads }
    })
  },
  getFavoriteThreads: () => {
    return Object.values(get().threads).filter((thread) => thread.isFavorite)
  },
  getThreadById: (threadId: string) => {
    return get().threads[threadId]
  },
  setCurrentThreadId: (threadId) => {
    set({ currentThreadId: threadId })
  },
  createThread: async (model, title, assistant) => {
    const newThread: Thread = {
      id: ulid(),
      title: title ?? 'New Thread',
      model,
      updated: Date.now() / 1000,
      assistants: assistant ? [assistant] : [],
    }
    return await getServiceHub().threads().createThread(newThread).then((createdThread) => {
      set((state) => {
        // Get all existing threads as an array
        const existingThreads = Object.values(state.threads)

        // Create new array with the new thread at the beginning
        const reorderedThreads = [createdThread, ...existingThreads]

        // Use setThreads to handle proper ordering (this will assign order 1, 2, 3...)
        get().setThreads(reorderedThreads)

        return {
          currentThreadId: createdThread.id,
        }
      })
      return createdThread
    })
  },
  updateCurrentThreadAssistant: (assistant) => {
    set((state) => {
      if (!state.currentThreadId) return { ...state }
      const currentThread = state.getCurrentThread()
      if (currentThread)
        getServiceHub().threads().updateThread({
          ...currentThread,
          assistants: [{ ...assistant, model: currentThread.model }],
        })
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...state.threads[state.currentThreadId as string],
            assistants: [assistant],
            updated: Date.now() / 1000,
          },
        },
      }
    })
  },
  updateCurrentThreadModel: (model) => {
    set((state) => {
      if (!state.currentThreadId) return { ...state }
      const currentThread = state.getCurrentThread()
      if (currentThread) getServiceHub().threads().updateThread({ ...currentThread, model })
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
        updated: Date.now() / 1000,
      }
      getServiceHub().threads().updateThread(updatedThread) // External call, order is fine
      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: new Fzf<Thread[]>(Object.values(newThreads), {
          selector: (item: Thread) => item.title,
        }),
      }
    })
  },
  getCurrentThread: () => {
    const { currentThreadId, threads } = get()
    return currentThreadId ? threads[currentThreadId] : undefined
  },
  updateThreadTimestamp: (threadId) => {
    set((state) => {
      const thread = state.threads[threadId]
      if (!thread) return state

      // Update the thread with new timestamp and set it to order 1 (top)
      const updatedThread = {
        ...thread,
        updated: Date.now() / 1000,
      }

      // Update all other threads to increment their order by 1
      const updatedThreads = { ...state.threads }
      updatedThreads[threadId] = updatedThread

      // Update the backend for the main thread
      getServiceHub().threads().updateThread(updatedThread)

      return {
        threads: updatedThreads,
        searchIndex: new Fzf<Thread[]>(Object.values(updatedThreads), {
          selector: (item: Thread) => item.title,
        }),
      }
    })
  },
}))
