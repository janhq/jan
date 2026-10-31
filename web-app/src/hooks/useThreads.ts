import { create } from 'zustand'
import { ulid } from 'ulidx'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Fzf } from 'fzf'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useAgentMode } from '@/hooks/useAgentMode'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { useChatSessions } from '@/stores/chat-session-store'
import { useAppState } from '@/hooks/useAppState'
import {
  cleanupThreadWorkspace,
  cancelAgentThreadBash,
  stopAgentSessionMonitors,
} from '@/lib/agentTools'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { abortRun } from '@/lib/coworkRunner'
import { dropMonitorLane } from '@/lib/coworkMonitor'
import { isCoworkThread, workspaceScopeFor } from '@/lib/threadMode'

type ThreadState = {
  threads: Record<string, Thread>
  isLoadingThreads: boolean
  setThreadsLoading: (loading: boolean) => void
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
  updateCurrentThreadAssistant: (assistant: Assistant) => void
  updateThreadAssistantIfUnchanged: (threadId: string, expected: Assistant, parameters: Record<string, unknown>) => Promise<Assistant | undefined>
  updateThreadTimestamp: (threadId: string) => void
  updateThread: (threadId: string, updates: Partial<Thread>) => void
  deleteAllThreadsByProject: (projectId: string) => Promise<void>
  searchIndex: Fzf<Thread[]> | null
}

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
const cleanupThreadArtifacts = (threadId: string, thread?: Thread) => {
  cleanupVectorDB(threadId)
  cleanupThreadCache(threadId)
  // Cowork conversations keep their sandbox in the session scope.
  cleanupThreadWorkspace(threadId, workspaceScopeFor(thread))
}

export const useThreads = create<ThreadState>()((set, get) => ({
  threads: {},
  isLoadingThreads: true,
  setThreadsLoading: (loading) => set({ isLoadingThreads: loading }),
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
      cleanupThreadArtifacts(threadId, state.threads[threadId])
      getServiceHub().threads().deleteThread(threadId)

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

      // Identify threads to keep (favorites OR have project metadata)
      const threadsToKeepIds = allThreadIds.filter(
        (threadId) =>
          state.threads[threadId].isFavorite ||
          state.threads[threadId].metadata?.project ||
          isCoworkThread(state.threads[threadId])
      )

      // Identify threads to delete (non-favorites AND no project metadata)
      const threadsToDeleteIds = allThreadIds.filter(
        (threadId) =>
          !state.threads[threadId].isFavorite &&
          !state.threads[threadId].metadata?.project &&
          !isCoworkThread(state.threads[threadId])
      )

      // Delete threads and clean up their out-of-store artifacts. As in
      // deleteThread: removing the chat session is what ends a turn the thread
      // still has running in the background.
      threadsToDeleteIds.forEach((threadId) => {
        useAgentMode.getState().removeThread(threadId)
        useChatSessions.getState().removeSession(threadId)
        useAppState.getState().clearThreadState(threadId)
        cleanupThreadArtifacts(threadId, state.threads[threadId])
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
        cleanupThreadArtifacts(threadId, state.threads[threadId])
        getServiceHub().threads().deleteThread(threadId)
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
  deleteAllThreadsByProject: async (projectId) => {
    // Wait before mutating sessions so their removals cannot precede the sync subscription.
    const sync = await import('@/lib/coworkSync')
    await sync.startCoworkSync()
    // The session is authoritative even while its mirrored thread metadata is
    // waiting for the persistence debounce (including moves out of a project).
    const sessions = useCoworkSessions.getState().sessions
    const sessionsById = new Map(sessions.map((session) => [session.id, session]))
    const projectThreads = Object.values(get().threads).filter((thread) => {
      const session = sessionsById.get(thread.id)
      return (session && session.unavailable !== 'id-collision' ? session.project?.id : thread.metadata?.project?.id) === projectId
    })
    // Sessions can exist before their first write has mirrored them into threads.
    const collisionIds = new Set(sessions.filter(
      (session) => session.project?.id === projectId && session.unavailable === 'id-collision'
    ).map((session) => session.id))
    const coworkIds = new Set([
      ...projectThreads.filter(isCoworkThread).map((thread) => thread.id),
      ...sessions.filter((session) => session.project?.id === projectId && session.unavailable !== 'id-collision').map((session) => session.id),
    ])

    // Reconcile each durable success immediately, even if a later delete fails.
    const reconcile = (id: string, cowork: boolean) => {
      const thread = get().threads[id]
      useAgentMode.getState().removeThread(id)
      useChatSessions.getState().removeSession(id)
      useAppState.getState().clearThreadState(id)
      if (!cowork) cleanupThreadArtifacts(id, thread)
      set((state) => {
        const remainingThreads = { ...state.threads }
        delete remainingThreads[id]
        return {
          threads: remainingThreads,
          currentThreadId: state.currentThreadId === id ? undefined : state.currentThreadId,
          searchIndex: new Fzf<Thread[]>(Object.values(remainingThreads).filter(t => t.id !== TEMPORARY_CHAT_ID && t.title), {
            selector: (item: Thread) => item.title ?? '',
          }),
        }
      })
    }
    const failures: unknown[] = []
    for (const thread of projectThreads) {
      if (coworkIds.has(thread.id)) continue
      try {
        await getServiceHub().threads().deleteThread(thread.id)
        reconcile(thread.id, false)
      } catch (error) {
        failures.push(error)
      }
    }

    // Collision placeholders are separate records from their same-ID chats.
    // Removing one via sync preserves the real chat; it must not suppress the
    // ordinary project chat deletion above or cancel that chat's running tools.
    for (const id of new Set([...coworkIds, ...collisionIds])) {
      try {
        if (coworkIds.has(id)) {
          abortRun(id)
          void cancelAgentThreadBash(id)
          void stopAgentSessionMonitors(id)
          dropMonitorLane(id)
          useCoworkRun.getState().clearMonitors(id)
        }
        useCoworkSessions.getState().deleteSession(id)
        // Sync owns persistence and workspace cleanup. Flush one removal at a
        // time so a later failure cannot strand an already-deleted thread.
        await sync.flushCoworkDeletes()
        if (coworkIds.has(id)) reconcile(id, true)
      } catch (error) {
        failures.push(error)
        // Sync's flush reports shared pending-delete failures. Leave remaining
        // sessions untouched for retry rather than attributing that failure to
        // another session's deletion.
        break
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, failures.map(String).join('; '))
    }
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
    const updatedThread = { ...thread, assistants: [assistant], updated: Date.now() / 1000 }
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
}))
