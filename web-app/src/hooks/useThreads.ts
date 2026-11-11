import { create } from 'zustand'
import { toast } from 'sonner'
import { i18n } from '@/i18n/react-i18next-compat'
import { ulid } from 'ulidx'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Fzf } from 'fzf'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useAgentMode } from '@/hooks/useAgentMode'
import { getExtensionHost } from '@/lib/extensions/host'
import { ServiceKeys } from '@janhq/core'
import { useChatSessions } from '@/stores/chat-session-store'
import { useAppState } from '@/hooks/useAppState'
import { cleanupThreadWorkspace } from '@/lib/agentTools'
import { isCoworkThread } from '@/lib/threadMode'
import { forgetMessageWrites } from '@/hooks/useMessages'
import {
  deleteCoworkConversation,
  hasCoworkSession,
} from '@/lib/coworkDelete'

type ThreadState = {
  threads: Record<string, Thread>
  isLoadingThreads: boolean
  setThreadsLoading: (loading: boolean) => void
  /** Set once a thread listing succeeded (an empty one counts). Unlike
   * `isLoadingThreads` it is never set by the retry-exhaustion path, so it
   * means "the list is real", not "we stopped waiting". */
  threadsHydrated: boolean
  markThreadsHydrated: () => void
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
  updateCurrentThreadModel: (model: ThreadModel) => void
  getFilteredThreads: (searchTerm: string) => Thread[]
  updateCurrentThreadAssistant: (assistant: Assistant | undefined) => void
  /**
   * Persist new sampling parameters on one thread's assistant. Resolves to the
   * saved assistant, or undefined when the thread's assistant changed (identity)
   * before or during the write, so a stale save never overwrites a newer choice.
   */
  updateThreadAssistantIfUnchanged: (
    threadId: string,
    expected: Assistant,
    parameters: Record<string, unknown>
  ) => Promise<Assistant | undefined>
  updateThreadTimestamp: (threadId: string) => void
  updateThread: (threadId: string, updates: Partial<Thread>) => void
  /**
   * Attach a folder to a chat thread, or detach it with `null`. Resolves once
   * the record is on disk, because that record is what the tools read when
   * they run: a send right after attaching must find the folder there.
   */
  setThreadFolder: (threadId: string, folder: string | null) => Promise<void>
  deleteAllThreadsByProject: (projectId: string) => void
  searchIndex: Fzf<Thread[]> | null
}

// Helper function to clean up vector DB collection for a thread
const cleanupVectorDB = async (threadId: string) => {
  try {
    await getExtensionHost().services.get(ServiceKeys.VectorDB)?.deleteCollection(
      `attachments_${threadId}`
    )
  } catch (e) {
    console.warn(
      `[Threads] Failed to delete vector DB collection for thread ${threadId}:`,
      e
    )
  }
}

/**
 * Drops the thread's saved prompt cache in the local engine.
 *
 * Best-effort and fire-and-forget, like the vector DB cleanup above: the cache
 * is bounded by its own disk budget, so failing to reclaim one thread's share
 * is not worth failing the delete over.
 */
const cleanupThreadCache = async (threadId: string) => {
  try {
    const { EngineManager } = await import('@janhq/core')
    const engine = EngineManager.instance().get('llamacpp') as
      | { forgetThreadCache?: (id: string) => Promise<number> }
      | undefined
    await engine?.forgetThreadCache?.(threadId)
  } catch (e) {
    console.warn(
      `[Threads] Failed to drop the saved prompt cache for thread ${threadId}:`,
      e
    )
  }
}

// Everything belonging to a thread that lives outside the thread store: its
// vector DB collection, its saved prompt cache, and its ephemeral agent
// sandbox. Fire-and-forget, since every caller runs inside a `set` reducer;
// each logs its own failures.
const cleanupThreadArtifacts = (threadId: string) => {
  cleanupVectorDB(threadId)
  cleanupThreadCache(threadId)
  cleanupThreadWorkspace(threadId)
}

/**
 * What the sidebar's Delete All removes: plain chats only. Favorites, anything
 * with project metadata (even a project that no longer exists, so no data is
 * lost to a dangling reference) and Cowork threads are kept.
 */
export const isDeletedByDeleteAll = (thread: Thread): boolean =>
  !thread.isFavorite && !thread.metadata?.project && !isCoworkThread(thread)

/**
 * The deletion of one thread plus its out-of-store artifacts. A Cowork thread
 * that is live in the session store is deleted through that store (see
 * `deleteCoworkConversation`), which journals it, removes the thread and
 * reclaims the sandbox itself; everything else goes straight to the thread
 * service.
 */
const deleteThreadEverywhere = (threadId: string, thread: Thread | undefined) => {
  forgetMessageWrites(threadId)
  if (isCoworkThread(thread) && hasCoworkSession(threadId)) {
    deleteCoworkConversation(threadId)
    return
  }
  cleanupThreadArtifacts(threadId)
  // The row is already gone from the list; when the files stay behind the
  // conversation comes back on restart, so the user is told now.
  void getServiceHub()
    .threads()
    .deleteThread(threadId)
    .catch((error) => {
      console.error(`Could not delete thread ${threadId}:`, error)
      toast.error(i18n.t('common:deleteThreadFailed'), {
        description: String(error),
      })
    })
}

export const useThreads = create<ThreadState>()((set, get) => ({
  threads: {},
  isLoadingThreads: true,
  setThreadsLoading: (loading) => set({ isLoadingThreads: loading }),
  threadsHydrated: false,
  markThreadsHydrated: () => set({ threadsHydrated: true }),
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
    // Filter out threads without valid titles for search index
    const filteredForSearch = Object.values(threadMap).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID && t.title
    )

    set({
      threads: threadMap,
      searchIndex: new Fzf<Thread[]>(filteredForSearch, {
        selector: (item: Thread) => item.title ?? '',
      }),
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
      currentIndex = new Fzf<Thread[]>(filteredThreadsValues.filter(t => t.title), {
        selector: (item: Thread) => item.title ?? '',
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

      useAgentMode.getState().removeThread(threadId)
      useChatSessions.getState().removeSession(threadId)
      useAppState.getState().clearThreadState(threadId)
      deleteThreadEverywhere(threadId, state.threads[threadId])

      return {
        threads: remainingThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(remainingThreads).filter(
            (t) => t.id !== TEMPORARY_CHAT_ID && t.title
          ),
          {
            selector: (item: Thread) => item.title ?? '',
          }
        ),
      }
    })
  },
  deleteAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Threads to keep: everything Delete All does not delete (favorites,
      // project threads and Cowork conversations).
      const threadsToKeepIds = allThreadIds.filter(
        (threadId) => !isDeletedByDeleteAll(state.threads[threadId])
      )
      const threadsToDeleteIds = allThreadIds.filter((threadId) =>
        isDeletedByDeleteAll(state.threads[threadId])
      )

      // Delete threads and clean up their out-of-store artifacts. As in
      // deleteThread: removing the chat session is what ends a turn the thread
      // still has running in the background.
      threadsToDeleteIds.forEach((threadId) => {
        useAgentMode.getState().removeThread(threadId)
        useChatSessions.getState().removeSession(threadId)
        useAppState.getState().clearThreadState(threadId)
        deleteThreadEverywhere(threadId, state.threads[threadId])
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
        searchIndex: new Fzf<Thread[]>(
          Object.values(remainingThreads).filter(
            (t) => t.id !== TEMPORARY_CHAT_ID && t.title
          ),
          {
            selector: (item: Thread) => item.title ?? '',
          }
        ),
      }
    })
  },
  clearAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      allThreadIds.forEach((threadId) => {
        useAgentMode.getState().removeThread(threadId)
        useChatSessions.getState().removeSession(threadId)
        useAppState.getState().clearThreadState(threadId)
        deleteThreadEverywhere(threadId, state.threads[threadId])
      })

      return {
        threads: {},
        currentThreadId: undefined,
        searchIndex: new Fzf<Thread[]>([], {
          selector: (item: Thread) => item.title ?? '',
        }),
      }
    })
  },
  deleteAllThreadsByProject: (projectId) => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Identify threads belonging to this project
      const threadsToDeleteIds = allThreadIds.filter(
        (threadId) =>
          state.threads[threadId].metadata?.project?.id === projectId
      )

      threadsToDeleteIds.forEach((threadId) => {
        useChatSessions.getState().removeSession(threadId)
        useAppState.getState().clearThreadState(threadId)
        deleteThreadEverywhere(threadId, state.threads[threadId])
      })

      // Keep threads that don't belong to this project
      const remainingThreads = allThreadIds
        .filter((threadId) => !threadsToDeleteIds.includes(threadId))
        .reduce(
          (acc, threadId) => {
            acc[threadId] = state.threads[threadId]
            return acc
          },
          {} as Record<string, Thread>
        )

      return {
        threads: remainingThreads,
        searchIndex: new Fzf<Thread[]>(Object.values(remainingThreads).filter(t => t.id !== TEMPORARY_CHAT_ID && t.title), {
          selector: (item: Thread) => item.title ?? '',
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
    return await getServiceHub()
      .threads()
      .createThread(newThread)
      .then((createdThread) => {
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
  // Sampling saves must never resolve "current thread" after an await. The
  // object identity also guards a newer selection of the same assistant ID.
  updateThreadAssistantIfUnchanged: async (threadId, expected, parameters) => {
    const thread = get().threads[threadId]
    if (thread?.assistants?.[0] !== expected) return undefined
    const assistant = { ...expected, parameters, model: thread.model }
    const updatedThread = {
      ...thread,
      assistants: [assistant],
      updated: Date.now() / 1000,
    }
    await getServiceHub().threads().updateThread(updatedThread)
    if (get().threads[threadId]?.assistants?.[0] !== expected) return undefined
    set((state) => ({
      threads: {
        ...state.threads,
        [threadId]: { ...state.threads[threadId], assistants: [assistant] },
      },
    }))
    return assistant
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
            assistants: assistant ? [{ ...assistant, model: currentThread.model }] : [],
          })
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...state.threads[state.currentThreadId as string],
            assistants: assistant
              ? [{ ...assistant, model: currentThread?.model }]
              : [],
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
        metadata: { ...thread.metadata, titleSetManually: true },
      }
      getServiceHub().threads().updateThread(updatedThread) // External call, order is fine
      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(newThreads).filter((t) => t.id !== TEMPORARY_CHAT_ID && t.title),
          {
            selector: (item: Thread) => item.title ?? '',
          }
        ),
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
        searchIndex: new Fzf<Thread[]>(
          Object.values(updatedThreads).filter(
            (t) => t.id !== TEMPORARY_CHAT_ID && t.title
          ),
          {
            selector: (item: Thread) => item.title ?? '',
          }
        ),
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

      getServiceHub().threads().updateThread(updatedThread)

      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(newThreads).filter((t) => t.id !== TEMPORARY_CHAT_ID && t.title),
          {
            selector: (item: Thread) => item.title ?? '',
          }
        ),
      }
    })
  },
  setThreadFolder: async (threadId, folder) => {
    const thread = get().threads[threadId]
    if (!thread) return
    const metadata = { ...thread.metadata }
    if (folder) {
      metadata.folder = folder
      metadata.folderAccess = 'write'
    } else {
      delete metadata.folder
      delete metadata.folderAccess
    }
    await getServiceHub()
      .threads()
      .updateThread({ ...thread, metadata, updated: Date.now() / 1000 })
    // Applied onto the thread as it is now: other metadata may have changed
    // while the write was in flight.
    set((state) => {
      const current = state.threads[threadId]
      if (!current) return state
      const next = { ...current.metadata }
      delete next.folder
      delete next.folderAccess
      if (folder) Object.assign(next, { folder, folderAccess: 'write' })
      return {
        threads: { ...state.threads, [threadId]: { ...current, metadata: next } },
      }
    })
  },
}))
