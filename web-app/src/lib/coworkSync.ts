import { quiesceChats, resumeChatsAfterPreventedClose, withChatCloseDeadline } from '@/lib/chatClose'
import { flushMessageWrites } from '@/hooks/useMessages'
import { quiesceCoworkRuns, resumeCoworkAfterPreventedClose, __resetCoworkRunCloseForTests } from '@/hooks/useCoworkRun'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  createCoworkPersistence,
  loadCoworkSessions,
  type CoworkPersistence,
} from '@/lib/coworkPersistence'
import {
  isCoworkMigrationSettled,
  migrateCoworkSessionsToThreads,
  type Invoke,
} from '@/lib/migrateCoworkSessions'
import { cleanupThreadWorkspace, sweepSessionWorkspaces } from '@/lib/agentTools'
import { discardStaleCoworkHandoffs } from '@/lib/coworkHandoff'

/**
 * Connects the Cowork session store to thread storage (see
 * plans/merge-chat-cowork-data-model.md, phase 2).
 *
 * Startup, in order: migrate legacy `code-sessions` -> threads, load Cowork
 * threads, MERGE them into the store (sessions created in the meantime are
 * kept), then start write-through. Write-through is not running while the store
 * is being hydrated, so loading never writes anything back.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

let persistence: CoworkPersistence | null = null
let unsubscribe: (() => void) | null = null
let startPromise: Promise<void> | null = null
let migrationSettled = false
const pendingDeletes = new Set<Promise<void>>()
let deleteFailure: unknown = null

const getInvoke = (): Invoke => {
  const core = getServiceHub().core()
  return core.invoke.bind(core) as Invoke
}

/** Mirror a persisted Cowork thread into the shared thread list (and search). */
function upsertThread(thread: Json) {
  const model = thread.assistants?.[0]?.model
  const existing = useThreads.getState().threads[thread.id]
  const next = {
    ...(existing ?? {}),
    ...thread,
    model:
      model && model.id !== '*'
        ? { id: model.id, provider: model.engine ?? 'llamacpp' }
        : existing?.model,
    updated: thread.updated,
    metadata: { ...(thread.metadata ?? {}) },
  } as Thread
  const all = { ...useThreads.getState().threads, [next.id]: next }
  useThreads.getState().setThreads(Object.values(all))
}

function removeThread(id: string) {
  const { [id]: _gone, ...rest } = useThreads.getState().threads
  void _gone
  useThreads.getState().setThreads(Object.values(rest))
}

function diff(prev: CoworkSession[], next: CoworkSession[]) {
  const before = new Map(prev.map((s) => [s.id, s]))
  const after = new Set(next.map((s) => s.id))
  const changed = next.filter((s) => before.get(s.id) !== s)
  const removed = prev.filter((s) => !after.has(s.id)).map((s) => s.id)
  return { changed, removed }
}

export function getCoworkPersistence(): CoworkPersistence | null {
  return persistence
}

export function isCoworkMigrationDone(): boolean {
  return migrationSettled
}

/** Await queued and in-flight Cowork writes (used before the window closes). */
export async function flushCoworkDeletes(): Promise<void> {
  if (startPromise) await startPromise
  await Promise.all([...pendingDeletes])
  if (deleteFailure) {
    const failure = deleteFailure
    deleteFailure = null
    throw failure
  }
}

export async function flushCowork(): Promise<void> {
  await persistence?.flush()
}

export function startCoworkSync(): Promise<void> {
  if (!isPlatformTauri()) return Promise.resolve()
  startPromise ??= doStart().catch((e) => {
    startPromise = null
    console.warn('[cowork] sync failed to start; operations must retry initialization:', e)
    throw e
  })
  return startPromise
}

async function doStart() {
  const invoke = getInvoke()

  // 1. One-time, idempotent copy of legacy sessions into threads. Never throws.
  const result = await migrateCoworkSessionsToThreads(invoke)
  migrationSettled =
    result.status !== 'partial' || (await isCoworkMigrationSettled(invoke))

  // 2. Load. A partial migration keeps legacy-only sessions visible.
  const loaded = await loadCoworkSessions(invoke, { migrationSettled })

  const p = createCoworkPersistence(invoke, {
    onThreadWritten: upsertThread,
    onThreadRemoved: removeThread,
    onError: (id, e) => console.warn(`[cowork] write failed for ${id}:`, e),
  })
  p.adopt(loaded.threads)
  persistence = p

  // 3. Merge: sessions created before hydration finished are kept.
  useCoworkSessions.setState((s) => {
    const have = new Set(loaded.sessions.map((x) => x.id))
    const early = s.sessions.filter((x) => !have.has(x.id))
    const sessions = [...early, ...loaded.sessions]
    const currentId =
      s.currentId && sessions.some((x) => x.id === s.currentId)
        ? s.currentId
        : loaded.currentId
    return { sessions, currentId }
  })

  // Cowork conversations also live in the shared thread list so search and the
  // sidebar see them. Do this once; later writes upsert through onThreadWritten.
  for (const t of loaded.threads) upsertThread(t)

  // A first prompt handed over for a session that no longer exists (reload
  // before its first commit) must not linger.
  try {
    discardStaleCoworkHandoffs(
      new Set(useCoworkSessions.getState().sessions.map((x) => x.id))
    )
  } catch {
    /* sessionStorage unavailable */
  }

  // 4. Sandboxes of conversations that no longer exist. Only once the migration
  //    settled: while it is partial the live-id list is incomplete.
  if (migrationSettled && loaded.sessions.length > 0) {
    void sweepSessionWorkspaces(loaded.sessions.map((s) => s.id))
  }

  // 5. Write-through from here on.
  let prev = useCoworkSessions.getState()
  p.setCurrentId(prev.currentId)
  unsubscribe?.()
  unsubscribe = useCoworkSessions.subscribe((state) => {
    if (state.currentId !== prev.currentId) p.setCurrentId(state.currentId)
    if (state.sessions !== prev.sessions) {
      const { changed, removed } = diff(prev.sessions, state.sessions)
      for (const s of changed) {
        p.schedule(s, { legacy: loaded.legacyIds.has(s.id) })
      }
      for (const id of removed) {
        const snapshot = prev.sessions.find((session) => session.id === id)
        const removal = (async () => {
          await p.remove(id, { recordDeleted: !migrationSettled, preserveThread: snapshot?.unavailable === 'id-collision' })
          // Workspace reclamation cannot turn a successful durable deletion
          // back into a visible session. It is best-effort and retried by sweep.
          if (snapshot?.unavailable !== 'id-collision') {
            try { await cleanupThreadWorkspace(id, 'session') } catch (error) { console.warn('Workspace cleanup failed:', error) }
          }
        })()
        pendingDeletes.add(removal)
        void removal.catch((error) => {
          deleteFailure = error
          if (snapshot) useCoworkSessions.setState((current) => ({
            sessions: current.sessions.some((session) => session.id === id)
              ? current.sessions : [...current.sessions, snapshot],
          }))
          console.warn(`[cowork] delete failed for ${id}:`, error)
        }).finally(() => pendingDeletes.delete(removal))
      }
    }
    prev = state
  })

  // 6. Flush when the app is hidden or closed.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void Promise.all([p.flush(), flushCoworkDeletes()]).catch((error) => console.warn('Cowork background flush failed:', error))
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { void Promise.all([p.flush(), flushCoworkDeletes()]).catch((error) => console.warn('Cowork unload flush failed:', error)) })
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().onCloseRequested(async (event) => {
        // Awaiting here holds the close until every queued and in-flight write
        // has settled. On failure keep the window (and unsaved state) alive;
        // another close request can retry storage rather than lose the run.
        try {
          // A live run has not committed its question/transcript/wire history
          // yet. Stop it and await its final commit before draining storage.
          // Still flush other sessions if one participant fails to settle cleanly.
          await withChatCloseDeadline((async () => {
              const runs = await Promise.allSettled([quiesceCoworkRuns(), quiesceChats()])
              const writes = await Promise.allSettled([p.flush(), flushCoworkDeletes(), flushMessageWrites()])
              const failed = [...runs, ...writes].find((result) => result.status === 'rejected')
              if (failed?.status === 'rejected') throw failed.reason
            })())
        } catch (e) {
          event.preventDefault()
          resumeCoworkAfterPreventedClose()
          resumeChatsAfterPreventedClose()
          console.warn('[cowork] flush on close failed:', e)
        }
      })
    } catch (e) {
      console.warn('[cowork] could not register the close handler:', e)
    }
  }
}

/** Test seam: forget all module state. */
export function __resetCoworkSyncForTests() {
  __resetCoworkRunCloseForTests()
  unsubscribe?.()
  unsubscribe = null
  persistence = null
  startPromise = null
  migrationSettled = false
  pendingDeletes.clear()
  deleteFailure = null
}
