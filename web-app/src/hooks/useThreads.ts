import { create } from 'zustand'
import { ulid } from 'ulidx'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Fzf } from 'fzf'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useAgentMode } from '@/hooks/useAgentMode'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import posthog from 'posthog-js'

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
  clearAllThreads: () => void
  unstarAllThreads: () => void
  setCurrentThreadId: (threadId?: string) => void
  createThread: (
    model: ThreadModel,
    title?: string,
    assistant?: Assistant,
    projectMetadata?: { id: string; name: string; updated_at: number },
    isTemporary?: boolean
  ) => Promise<Thread>
  awaitThreadPersistence: (threadId: string) => Promise<void>
  updateCurrentThreadModel: (model: ThreadModel) => void
  getFilteredThreads: (searchTerm: string) => Thread[]
  updateCurrentThreadAssistant: (assistant: Assistant) => void
  updateThreadTimestamp: (threadId: string) => void
  updateThread: (threadId: string, updates: Partial<Thread>) => void
  deleteAllThreadsByProject: (projectId: string) => void
  searchIndex: Fzf<Thread[]> | null
}

// Tracks in-flight backend persistence for threads created optimistically so
// callers (e.g. the thread page when issuing the first sendMessage) can wait
// for the row to land in storage before issuing dependent operations. Kept
// outside the store to avoid forcing re-renders when a promise lands.
const pendingThreadPersistence = new Map<string, Promise<void>>()

const buildSearchIndex = (threads: Record<string, Thread>): Fzf<Thread[]> =>
  new Fzf<Thread[]>(
    Object.values(threads).filter((t) => t.id !== TEMPORARY_CHAT_ID && t.title),
    { selector: (item: Thread) => item.title ?? '' }
  )

// Helper function to clean up vector DB collection for a thread
const cleanupVectorDB = async (threadId: string) => {
  try {
    const vec = ExtensionManager.getInstance().get<VectorDBExtension>(
      ExtensionTypeEnum.VectorDB
    )
    if (vec?.deleteCollection) {
      await vec.deleteCollection(`attachments_${threadId}`)
    }
  } catch (e) {
    console.warn(
      `[Threads] Failed to delete vector DB collection for thread ${threadId}:`,
      e
    )
  }
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
                provider:
                  thread.model?.provider?.replace('llama.cpp', 'llamacpp') ??
                  'llamacpp',
                // Cortex migration: take first two parts of the ID (the last is file name which is not needed)
                id:
                  thread.model?.provider === 'llama.cpp' ||
                  thread.model?.provider === 'llamacpp'
                    ? thread.model?.id
                        ?.split(':')
                        .slice(0, 2)
                        .join(getServiceHub().path().sep())
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
      searchIndex: buildSearchIndex(threadMap),
    })
  },
  getFilteredThreads: (searchTerm: string) => {
    const { threads, searchIndex } = get()

    // Filter out temporary chat from all operations
    const filteredThreadsValues = Object.values(threads).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID
    )

    // If no search term, return all threads
    if (!searchTerm) {
      // return all threads
      return filteredThreadsValues
    }

    let currentIndex = searchIndex
    if (!currentIndex?.find) {
      currentIndex = new Fzf<Thread[]>(
        filteredThreadsValues.filter((t) => t.title),
        {
          selector: (item: Thread) => item.title ?? '',
        }
      )
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
      getServiceHub()
        .threads()
        .updateThread({
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

      // Clean up agent mode state
      useAgentMode.getState().removeThread(threadId)
      // Clean up vector DB collection
      cleanupVectorDB(threadId)
      getServiceHub().threads().deleteThread(threadId)

      return {
        threads: remainingThreads,
        searchIndex: buildSearchIndex(remainingThreads),
      }
    })
  },
  deleteAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Identify threads to keep (favorites OR have project metadata)
      const threadsToKeepIds = allThreadIds.filter(
        (threadId) =>
          state.threads[threadId].isFavorite ||
          state.threads[threadId].metadata?.project
      )

      // Identify threads to delete (non-favorites AND no project metadata)
      const threadsToDeleteIds = allThreadIds.filter(
        (threadId) =>
          !state.threads[threadId].isFavorite &&
          !state.threads[threadId].metadata?.project
      )

      // Delete threads and clean up their vector DB collections
      threadsToDeleteIds.forEach((threadId) => {
        cleanupVectorDB(threadId)
        getServiceHub().threads().deleteThread(threadId)
      })

      // Keep favorite threads and threads with project metadata
      const remainingThreads = threadsToKeepIds.reduce(
        (acc, threadId) => {
          acc[threadId] = state.threads[threadId]
          return acc
        },
        {} as Record<string, Thread>
      )

      return {
        threads: remainingThreads,
        searchIndex: buildSearchIndex(remainingThreads),
      }
    })
  },
  clearAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Delete all threads and clean up their vector DB collections
      allThreadIds.forEach((threadId) => {
        useAgentMode.getState().removeThread(threadId)
        cleanupVectorDB(threadId)
        getServiceHub().threads().deleteThread(threadId)
      })

      return {
        threads: {},
        currentThreadId: undefined,
        searchIndex: buildSearchIndex({}),
      }
    })
  },
  deleteAllThreadsByProject: (projectId) => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Identify threads belonging to this project
      const toDeleteSet = new Set(
        allThreadIds.filter(
          (threadId) =>
            state.threads[threadId].metadata?.project?.id === projectId
        )
      )

      // Delete threads and clean up their vector DB collections
      toDeleteSet.forEach((threadId) => {
        cleanupVectorDB(threadId)
        getServiceHub().threads().deleteThread(threadId)
      })

      // Keep threads that don't belong to this project
      const remainingThreads = allThreadIds
        .filter((threadId) => !toDeleteSet.has(threadId))
        .reduce(
          (acc, threadId) => {
            acc[threadId] = state.threads[threadId]
            return acc
          },
          {} as Record<string, Thread>
        )

      return {
        threads: remainingThreads,
        searchIndex: buildSearchIndex(remainingThreads),
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
        getServiceHub()
          .threads()
          .updateThread({ ...thread, isFavorite: false })
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
    if (threadId !== get().currentThreadId) set({ currentThreadId: threadId })
  },
  createThread: async (
    model,
    title,
    assistant,
    projectMetadata,
    isTemporary
  ) => {
    const newThread: Thread = {
      id: isTemporary ? TEMPORARY_CHAT_ID : ulid(),
      title: title ?? (isTemporary ? 'Temporary Chat' : 'New Thread'),
      model,
      updated: Date.now() / 1000,
      assistants: assistant ? [assistant] : [],
      ...(projectMetadata &&
        !isTemporary && {
          metadata: {
            project: projectMetadata,
          },
        }),
      ...(isTemporary && {
        metadata: {
          isTemporary: true,
          ...(projectMetadata && { project: projectMetadata }),
        },
      }),
    }

    set((state) => {
      const existingThreads = Object.values(state.threads)
      const reorderedThreads = [newThread, ...existingThreads]
      get().setThreads(reorderedThreads)
      return { currentThreadId: newThread.id }
    })

    if (isTemporary) {
      return newThread
    }

    const persistPromise = getServiceHub()
      .threads()
      .createThread(newThread)
      .then((createdThread) => {
        posthog.capture('thread_created', {
          thread_id: createdThread.id,
          model_id: model.id,
          provider: model.provider,
          has_assistant: Boolean(assistant),
          has_project: Boolean(projectMetadata),
        })

        set((state) => {
          const nextThreads = { ...state.threads }

          if (createdThread.id !== newThread.id) {
            delete nextThreads[newThread.id]
          }

          nextThreads[createdThread.id] = {
            ...nextThreads[createdThread.id],
            ...createdThread,
          }

          return {
            threads: nextThreads,
            currentThreadId:
              state.currentThreadId === newThread.id
                ? createdThread.id
                : state.currentThreadId,
            searchIndex: buildSearchIndex(nextThreads),
          }
        })

        return createdThread
      })
      .catch((err) => {
        console.error('[Threads] Failed to persist thread:', err)
        throw err
      })
      .finally(() => {
        pendingThreadPersistence.delete(newThread.id)
      })

    pendingThreadPersistence.set(
      newThread.id,
      persistPromise.then(() => {})
    )

    const createdThread = await persistPromise
    return createdThread
  },
  awaitThreadPersistence: async (threadId) => {
    const pending = pendingThreadPersistence.get(threadId)
    if (!pending) return
    try {
      await pending
    } catch {
      // Errors are already logged by the persist promise; callers should
      // continue and let downstream ops surface their own failures rather
      // than silently aborting on a transient persistence error.
    }
  },
  updateCurrentThreadAssistant: (assistant) => {
    set((state) => {
      if (!state.currentThreadId) return { ...state }
      const currentThread = state.getCurrentThread()
      if (currentThread)
        getServiceHub()
          .threads()
          .updateThread({
            ...currentThread,
            assistants: assistant
              ? [{ ...assistant, model: currentThread.model }]
              : [],
          })
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...state.threads[state.currentThreadId as string],
            assistants: assistant ? [assistant] : [],
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
      if (currentThread)
        getServiceHub()
          .threads()
          .updateThread({ ...currentThread, model })
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
        searchIndex: buildSearchIndex(newThreads),
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
        searchIndex: buildSearchIndex(updatedThreads),
      }
    })
  },
  updateThread: (threadId, updates) => {
    set((state) => {
      const thread = state.threads[threadId]
      if (!thread) return state

      const updatedThread = {
        ...thread,
        ...updates,
        updated: Date.now() / 1000,
      }

      // If the thread was created optimistically and is still being
      // persisted, defer the backend update until the row exists to avoid
      // a race that produces a 404 / FK error. For already-persisted
      // threads this branch is skipped and the write happens immediately.
      const pendingPersist = pendingThreadPersistence.get(threadId)
      const writeBackend = () => {
        getServiceHub().threads().updateThread(updatedThread)
      }
      if (pendingPersist) {
        pendingPersist.then(writeBackend, writeBackend)
      } else {
        writeBackend()
      }

      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: buildSearchIndex(newThreads),
      }
    })
  },
}))
