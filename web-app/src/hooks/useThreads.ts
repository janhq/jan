import { create } from 'zustand'
import { ulid } from 'ulidx'
import { toast } from 'sonner'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Fzf } from 'fzf'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useMessages } from '@/hooks/useMessages'
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
import { revokeThreadCapabilitiesInHost, stopAllThreadAgentMonitors } from '@/lib/agentTools'
import { dropMonitorLane } from '@/lib/coworkMonitor'
import { isCoworkThread, workspaceScopeFor } from '@/lib/threadMode'
import { useChatPermissions } from '@/hooks/useChatPermissions'
import { defaultConversationCapabilities, HostRevokeUnconfirmedError, resolveConversationCapabilities, type ConversationCapabilitiesV1 } from '@/lib/conversationCapabilities'

type ThreadState = {
  threads: Record<string, Thread>
  isLoadingThreads: boolean
  setThreadsLoading: (loading: boolean) => void
  /**
   * SUCCESS-ONLY: true once a validated, successful full thread listing has
   * been applied. Unlike `isLoadingThreads` (which DataProvider also clears
   * when its retries are exhausted) this is never set on failure.
   */
  threadsHydrated: boolean
  markThreadsHydrated: () => void
  currentThreadId?: string
  getCurrentThread: () => Thread | undefined
  setThreads: (threads: Thread[]) => void
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  rollbackCreatedThread: (threadId: string, previousId?: string) => Promise<void>
  acceptCreatedThread: (threadId: string) => void
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
    isTemporary?: boolean,
    options?: { strict?: boolean }
  ) => Promise<Thread>
  updateCurrentThreadModel: (model: ThreadModel) => void
  getFilteredThreads: (searchTerm: string) => Thread[]
  updateCurrentThreadAssistant: (assistant: Assistant) => void
  updateThreadAssistantIfUnchanged: (threadId: string, expected: Assistant, parameters: Record<string, unknown>) => Promise<Assistant | undefined>
  updateThreadTimestamp: (threadId: string) => void
  updateThread: (threadId: string, updates: Partial<Thread>) => void
  setConversationCapabilities: (threadId: string, value: unknown) => Promise<void>
  getConversationCapabilities: (threadId: string) => ConversationCapabilitiesV1
  deleteAllThreadsByProject: (projectId: string) => Promise<void>
  searchIndex: Fzf<Thread[]> | null
}

// Consent writes replace/overlay metadata, so object identity is not a creation
// token. Ignore only that field; every other creation field must still match.
const createdThreadSnapshots = new Map<string, { snapshot: string; receipt: Thread }>()
function creationSnapshot(thread: Thread): string {
  const metadata = { ...thread.metadata }
  delete metadata.conversationCapabilities
  return JSON.stringify({ ...thread, metadata })
}

// Serialize capability writes per conversation so a slower save cannot restore
// older grants. Rejected writes must not block subsequent attempts.
const capabilityWrites = new Map<string, Promise<void>>()
const capabilityRequests = new Map<string, symbol>()
// The native listing sanitizes saved grants against host-owned durable denial
// markers. Load once per process; an explicit denied overlay always wins over
// subsequent listings, including stale in-flight responses.
const effectiveCapabilities = new Map<string, ConversationCapabilitiesV1>()

/** Threads whose last revoke the host never acknowledged while a grant may
 * still be live there. Sticky on purpose: the setter's own synchronous deny
 * erases the store state a RETRY would otherwise read, so without this a
 * second failure would look like "nothing was granted" and surfaces would
 * drop the background warning. Cleared the moment a narrow IS acknowledged
 * -- the host is provably denied from then on, whatever the persist does. */
const hostUncertainGrants = new Set<string>()

/** The capabilities each thread was most recently ASKED to save, recorded
 * synchronously at request start. A successor's `priorGrant` must count an
 * in-flight predecessor's requested elevation: that persist may land -- and
 * host-confirm -- after the successor has already read the optimistic deny
 * the predecessor wrote. Rolled back only when a request provably never
 * reached the strict setter; once a persist was attempted, a lost response
 * may still have confirmed host-side, so the value stays. */
const lastRequestedCapabilities = new Map<string, ConversationCapabilitiesV1>()

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

// A native delete can fail after local state was already cleared (e.g. a
// Windows file lock); silently dropping that leaves the thread gone from the
// UI now but back on the next launch. Restore it and surface the failure
// instead. Grants stay pruned in-process: the restored thread is default-deny.
// Its on-disk grant bytes survive, but confer no authority — a grant is only
// active after an in-process setter success (capability enforcement model).
const deleteThreadOnDisk = (threadId: string, thread?: Thread) => {
  // .then(() => ...) routes synchronous throws and non-promise returns (test
  // doubles) into the same catch as an async rejection.
  Promise.resolve()
    .then(() => getServiceHub().threads().deleteThread(threadId))
    .catch((error) => {
      console.warn(`[Threads] Failed to delete thread ${threadId} from storage:`, error)
      let restoredThread = false
      if (thread) {
        // The pre-delete record may still carry a consent grant in its
        // metadata. The capabilities getter no longer reads metadata (the
        // in-process map is the only authority source), so stripping it is
        // defense-in-depth: it keeps the stale grant from being re-persisted
        // by whole-record writers or trusted by a future metadata reader.
        const { conversationCapabilities: _staleGrant, ...metadata } = thread.metadata ?? {}
        void _staleGrant
        const restored: Thread = { ...thread, metadata }
        useThreads.setState((state) => {
          // A recreated/duplicate record keeps precedence (e.g. a second
          // delete attempt whose first already succeeded).
          if (state.threads[threadId]) return state
          restoredThread = true
          const threads = { ...state.threads, [threadId]: restored }
          return {
            threads,
            searchIndex: new Fzf<Thread[]>(
              Object.values(threads).filter((t) => t.id !== TEMPORARY_CHAT_ID && t.title),
              { selector: (item: Thread) => item.title ?? '' }
            ),
          }
        })
      }
      // Honest copy: cleanupThreadArtifacts ran before the native delete
      // (inherited ordering), so attachments index / cached state may already
      // be gone; only the conversation record itself is restored, and only
      // when there is actually something to restore.
      // Stable id: a bulk delete hitting locked storage coalesces into one
      // toast instead of stacking one per thread.
      toast.error('Failed to delete chat', {
        id: 'thread-delete-failed',
        description: restoredThread
          ? 'It could not be removed from storage. The conversation was restored, but some auxiliary data (attachment index, cache) may have been cleaned up.'
          : 'It could not be fully removed from storage.',
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
    const ids = new Set(threads.map((thread) => thread.id))
    for (const id of createdThreadSnapshots.keys()) {
      if (!ids.has(id)) createdThreadSnapshots.delete(id)
    }
    for (const id of capabilityRequests.keys()) {
      if (!ids.has(id)) capabilityRequests.delete(id)
    }
    for (const thread of threads) {
      if (!effectiveCapabilities.has(thread.id) && thread.id !== TEMPORARY_CHAT_ID && !isCoworkThread(thread)
        && Object.prototype.hasOwnProperty.call(thread.metadata ?? {}, 'conversationCapabilities')) {
        effectiveCapabilities.set(thread.id, resolveConversationCapabilities(thread.metadata?.conversationCapabilities))
      }
    }
    const threadMap = threads.reduce(
      (acc: Record<string, Thread>, thread) => {
        acc[thread.id] = {
          ...thread,
          ...(effectiveCapabilities.has(thread.id) && { metadata: {
            ...thread.metadata, conversationCapabilities: effectiveCapabilities.get(thread.id),
          } }),
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
  acceptCreatedThread: (threadId) => {
    const creation = createdThreadSnapshots.get(threadId)
    if (creation) getServiceHub().threads().releaseCreatedThread(creation.receipt)
    createdThreadSnapshots.delete(threadId)
  },
  rollbackCreatedThread: async (threadId, previousId) => {
    const created = get().threads[threadId]
    const creation = createdThreadSnapshots.get(threadId)
    const snapshot = creation?.snapshot
    const assertUnchangedEmpty = () => {
      const session = useChatSessions.getState().sessions[threadId]
      if (!threadId || threadId === TEMPORARY_CHAT_ID || !created || !snapshot ||
        !get().threads[threadId] || creationSnapshot(get().threads[threadId]) !== snapshot ||
        useMessages.getState().getMessages(threadId).length || session) {
        throw new Error('Created chat changed; refusing cleanup')
      }
    }
    assertUnchangedEmpty()
    // A pending consent write must settle before deletion, or it could recreate
    // metadata after the native delete. Its failure is the reason for rollback.
    await capabilityWrites.get(threadId)?.catch(() => {})
    assertUnchangedEmpty()
    await getServiceHub().threads().rollbackCreatedThread(threadId, creation!.receipt)
    try {
      assertUnchangedEmpty()
    } catch {
      // Disk deletion succeeded, but do not discard newly changed local work.
      throw new Error('Chat was deleted from storage, but changed locally during cleanup')
    }
    // Never remove local state before durable deletion succeeds. A switch to
    // another conversation while consent/deletion awaited belongs to the user.
    createdThreadSnapshots.delete(threadId)
    capabilityRequests.delete(threadId)
    effectiveCapabilities.set(threadId, defaultConversationCapabilities())
    set((state) => {
      const remainingThreads = { ...state.threads }
      delete remainingThreads[threadId]
      return {
        threads: remainingThreads,
        currentThreadId: state.currentThreadId === threadId
          ? (previousId && remainingThreads[previousId] ? previousId : undefined)
          : state.currentThreadId,
        searchIndex: new Fzf<Thread[]>(Object.values(remainingThreads).filter(t => t.id !== TEMPORARY_CHAT_ID && t.title), {
          selector: (item: Thread) => item.title ?? '',
        }),
      }
    })
  },
  deleteThread: (threadId) => {
    createdThreadSnapshots.delete(threadId)
    capabilityRequests.delete(threadId)
    effectiveCapabilities.set(threadId, defaultConversationCapabilities())
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [threadId]: _, ...remainingThreads } = state.threads

      useAgentMode.getState().removeThread(threadId)
      useChatSessions.getState().removeSession(threadId)
      useAppState.getState().clearThreadState(threadId)
      cleanupThreadArtifacts(threadId, state.threads[threadId])
      deleteThreadOnDisk(threadId, state.threads[threadId])

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
        createdThreadSnapshots.delete(threadId)
        effectiveCapabilities.set(threadId, defaultConversationCapabilities())
        capabilityRequests.delete(threadId)
        useAgentMode.getState().removeThread(threadId)
        useChatSessions.getState().removeSession(threadId)
        useAppState.getState().clearThreadState(threadId)
        cleanupThreadArtifacts(threadId, state.threads[threadId])
        deleteThreadOnDisk(threadId, state.threads[threadId])
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
    createdThreadSnapshots.clear()
    capabilityRequests.clear()
    for (const id of effectiveCapabilities.keys()) effectiveCapabilities.set(id, defaultConversationCapabilities())
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      allThreadIds.forEach((threadId) => {
        useAgentMode.getState().removeThread(threadId)
        useChatSessions.getState().removeSession(threadId)
        useAppState.getState().clearThreadState(threadId)
        cleanupThreadArtifacts(threadId, state.threads[threadId])
        deleteThreadOnDisk(threadId, state.threads[threadId])
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
      capabilityRequests.delete(id)
      effectiveCapabilities.set(id, defaultConversationCapabilities())
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
        // Revoke-first, as in the single delete above: while the native delete
        // is awaited a concurrent dispatch must not resolve grants for a
        // thread already being deleted. The record stays visible until
        // reconcile; since the getter reads only the in-process map, an
        // explicit default overlay and a pruned entry both resolve to
        // default-deny — the overlay matches the revoke path's explicit
        // semantics. On failure the thread survives but stays default-deny
        // (its on-disk grant bytes are inert without a new setter success);
        // on success reconcile drops the entry with the record. The overlay
        // deliberately stays in the map even if the id later leaves a fetched
        // list — setThreads must not prune it (deny-protection asymmetry).
        capabilityRequests.delete(thread.id)
        effectiveCapabilities.set(thread.id, defaultConversationCapabilities())
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
    isTemporary,
    options
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
      .createThread(newThread, ...(options ? [options] : []))
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
        const stored = get().threads[createdThread.id]
        if (stored && createdThread.id !== TEMPORARY_CHAT_ID) {
          createdThreadSnapshots.set(createdThread.id, { snapshot: creationSnapshot(stored), receipt: createdThread })
        }
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
  getConversationCapabilities: (threadId) => {
    const thread = get().threads[threadId]
    if (!thread || threadId === TEMPORARY_CHAT_ID || isCoworkThread(thread)) return defaultConversationCapabilities()
    // Network and memory writes are app-wide settings the host overlays on every
    // grant; the mirror keeps this view equal to what the host will enforce.
    // The folder stays a per-conversation grant.
    const { shellNetwork, memoryWrite } = useChatPermissions.getState()
    return { ...resolveConversationCapabilities(effectiveCapabilities.get(threadId)), shellNetwork, memoryWrite }
  },
  setConversationCapabilities: async (threadId, value) => {
    const assertChatThread = () => {
      const thread = get().threads[threadId]
      if (!thread) throw new Error(`Unknown thread: ${threadId}`)
      if (threadId === TEMPORARY_CHAT_ID) throw new Error('Conversation permissions require a regular chat')
      if (isCoworkThread(thread)) {
        throw new Error('Conversation capabilities cannot be set on Cowork threads')
      }
      return thread
    }
    const original = assertChatThread()
    const capabilities = resolveConversationCapabilities(value)
    // Whether anything is granted BEFORE this change, captured ahead of the
    // synchronous deny below, which erases both sources it reads.
    const elevatedIn = (c: ConversationCapabilitiesV1) =>
      c.shellNetwork || c.memoryWrite || c.folderScope !== null
    const previousRequested = lastRequestedCapabilities.get(threadId)
    const priorGrant =
      hostUncertainGrants.has(threadId) ||
      elevatedIn(resolveConversationCapabilities(effectiveCapabilities.get(threadId))) ||
      elevatedIn(resolveConversationCapabilities(original.metadata?.conversationCapabilities)) ||
      (previousRequested !== undefined && elevatedIn(previousRequested))
    lastRequestedCapabilities.set(threadId, capabilities)
    const request = Symbol(threadId)
    capabilityRequests.set(threadId, request)
    effectiveCapabilities.set(threadId, defaultConversationCapabilities())
    // Revoke synchronously before any await. Pending/failed persistence never
    // leaves old scoped authority live; ordinary Chat tools/MCP are separate.
    set((state) => ({ threads: { ...state.threads, [threadId]: {
      ...original,
      metadata: { ...original.metadata, conversationCapabilities: defaultConversationCapabilities() },
    } } }))
    const previous = capabilityWrites.get(threadId)
    const write = (async () => {
      // This request provably never reached the strict setter, so its value
      // can never be host-confirmed: stop counting it as a possible grant for
      // successors, resurfacing the predecessor's value, which still might be.
      const rollbackRequested = () => {
        if (lastRequestedCapabilities.get(threadId) === capabilities) {
          if (previousRequested === undefined) lastRequestedCapabilities.delete(threadId)
          else lastRequestedCapabilities.set(threadId, previousRequested)
        }
      }
      // The host never acknowledged a narrow, so background monitors may
      // still be polling under the old grant. Best effort: ask for a plain
      // stop (it rides the same IPC and may fail identically, and even a
      // successful stop leaves the host confirmation live). Either way this
      // write rejects structurally so the surface can tell the user the
      // truth; nothing is persisted and the denied overlay above stays.
      // Grants are never restored.
      const hostNarrowFailed = async (cause: unknown) => {
        await stopAllThreadAgentMonitors(threadId)
        rollbackRequested()
        if (priorGrant) hostUncertainGrants.add(threadId)
        // Settledness must be TRANSITIVE for the re-narrow proof below: a
        // request that fails here still drains its predecessor before it
        // settles, so a successor that sees THIS request settled knows every
        // older native call of ours has returned -- including across chains
        // of early narrow failures, where the successor may find no map entry
        // at all and take the single-narrow path on that guarantee.
        if (previous) await previous.catch(() => {})
        return new HostRevokeUnconfirmedError(threadId, priorGrant, cause)
      }
      // Narrow the host process before anything is persisted, and ahead of
      // the queue wait below, which may still be draining an earlier write.
      // The synchronous revoke above only clears this window's overlay; the
      // native monitor loop cannot read this store and authorizes each poll
      // against host-confirmed consent, so until this resolves a background
      // poll would still run under the grant being replaced. Narrowing only
      // ever denies, and a failure must not be reported as a revocation.
      try {
        await revokeThreadCapabilitiesInHost(threadId)
      } catch (cause) {
        throw await hostNarrowFailed(cause)
      }
      if (previous) {
        await previous.catch(() => {})
        // The narrow above is best-effort ONLY while a predecessor write was
        // in flight: that predecessor's native strict-setter call may already
        // have been authorized, and its own narrow-write-CONFIRM legitimately
        // postdates our ack, resurrecting the value it carried. Now that it
        // has settled, no request of ours can still confirm (successors queue
        // behind this one), so THIS narrow is the authoritative one: after
        // its ack, the host stays denied whatever our persist below does --
        // the native mirror is never restored by a failed or absent write.
        try {
          await revokeThreadCapabilitiesInHost(threadId)
        } catch (cause) {
          throw await hostNarrowFailed(cause)
        }
      }
      // The host acknowledged a narrow that postdates every possible confirm
      // of ours: it is provably denied from here until our own persist
      // confirms, so any earlier unacknowledged revoke is resolved even if
      // the persist below never runs or fails.
      hostUncertainGrants.delete(threadId)
      try {
        assertChatThread()
        // A newer request may have superseded this one while the narrow or
        // the earlier write settled. Checked BEFORE the strict setter runs:
        // persisting a superseded GRANT would have the native setter
        // re-confirm it -- narrow, write and confirm of THIS value -- leaving
        // host and disk authorizing a grant the user has already replaced,
        // live until the newer request's own setter lands and indefinitely if
        // that request fails first. The post-persist check below cannot
        // prevent that.
        if (capabilityRequests.get(threadId) !== request) {
          throw new Error('Conversation changed while saving permissions')
        }
      } catch (error) {
        rollbackRequested()
        throw error
      }
      await getServiceHub().threads().setConversationCapabilities(threadId, capabilities)
      assertChatThread()
      if (capabilityRequests.get(threadId) !== request) throw new Error('Conversation changed while saving permissions')
      effectiveCapabilities.set(threadId, capabilities)
      set((state) => ({ threads: { ...state.threads, [threadId]: {
        ...state.threads[threadId],
        metadata: { ...state.threads[threadId].metadata, conversationCapabilities: capabilities },
      } } }))
    })()
    capabilityWrites.set(threadId, write)
    try {
      await write
    } finally {
      if (capabilityWrites.get(threadId) === write) capabilityWrites.delete(threadId)
      if (capabilityRequests.get(threadId) === request) capabilityRequests.delete(threadId)
    }
  },
  updateThread: (threadId, updates) => {
    set((state) => {
      const thread = state.threads[threadId]
      if (!thread) return state

      const updatedThread = {
        ...thread,
        ...updates,
        // Ordinary metadata writers cannot grant or restore stale consent.
        metadata: {
          ...(updates.metadata ?? thread.metadata),
          ...(thread.metadata && Object.prototype.hasOwnProperty.call(thread.metadata, 'conversationCapabilities')
            ? { conversationCapabilities: thread.metadata.conversationCapabilities }
            : {}),
        },
        updated: Date.now() / 1000,
      }
      if (!Object.prototype.hasOwnProperty.call(thread.metadata ?? {}, 'conversationCapabilities')) {
        delete updatedThread.metadata.conversationCapabilities
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
