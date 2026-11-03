import { toast } from 'sonner'
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
let pendingStartupWarning: (() => void) | null = null

/**
 * Re-raise startup warnings once a sonner `<Toaster>` is mounted. Sonner drops
 * toasts created before its Toaster subscribes, and startup warnings are
 * raised while the providers still gate rendering on startup itself — so the
 * Toaster host calls this from its mount effect. Idempotent: warnings use
 * stable toast ids, so a re-fire updates rather than duplicates.
 */
export function flushCoworkStartupWarnings(): void {
  pendingStartupWarning?.()
}

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

/**
 * Durably record an ACCEPTED run's session (even while still empty) so the host
 * can read its record before the first tool call. Empty sessions are otherwise
 * never written; only a run that was accepted calls this.
 */
export async function ensureCoworkRecorded(id: string): Promise<void> {
  // Fail closed outside Tauri: there is no host to read the record, so a run
  // must not proceed (and browser tools are deliberately not enabled instead).
  if (!isPlatformTauri()) throw new Error('Cowork persistence requires the desktop app')
  await startCoworkSync()
  const session = useCoworkSessions.getState().sessions.find((s) => s.id === id)
  if (!session) throw new Error(`Cowork session ${id} is not available to record`)
  if (session.unavailable) throw new Error(`Cowork session ${id} is unavailable and cannot be recorded`)
  if (!persistence) throw new Error('Cowork persistence is unavailable')
  // Only a not-yet-durable session needs a write. An already durable one is
  // not re-queued, but still settles its own pending rollback / in-flight
  // delete via flushSession (a no-op with no storage calls when clean).
  if (!persistence.isPersisted(id)) persistence.schedule(session, { allowEmpty: true })
  await persistence.flushSession(id)
  if (!persistence.isPersisted(id)) throw new Error(`Cowork session ${id} was not recorded`)
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

  // Failing closed on an unreadable deletion journal must not hide data
  // silently: legacy sessions stay hidden and their deletion stays blocked on
  // EVERY launch until the journal is repaired, so warn persistently on every
  // launch with manual recovery instructions. Never auto-repair, quarantine,
  // or drop the journal: rewriting it could resurrect sessions the user
  // deleted. The corrupt value itself is left byte-for-byte untouched.
  if (loaded.deletionJournalError) {
    const warn = () =>
      toast.warning('Some imported Cowork conversations are hidden', {
        id: 'cowork-deletion-journal-unreadable',
        duration: Infinity,
        description:
          "Jan can't read its deletion record, so conversations imported from an " +
          'older version stay hidden rather than risk restoring ones you already ' +
          'deleted, and deleting any Cowork conversation is temporarily blocked. ' +
          'Your data is untouched. To recover: quit Jan completely first — Jan ' +
          'rewrites settings.json from memory while it runs, which would undo ' +
          "your edit — then fix or remove the 'cowork_deleted_ids' entry in " +
          'settings.json. Removing it restores every imported conversation, ' +
          'including any you had deleted.',
      })
    // This startup is what gates provider render, so the Toaster is usually
    // NOT mounted yet, and sonner drops toasts created before its <Toaster>
    // subscribes. Fire now for any already-mounted toaster (e.g. a retried
    // start) AND keep the warning for the post-mount flush; the stable id
    // makes double delivery idempotent (it updates, never duplicates).
    pendingStartupWarning = warn
    warn()
  } else {
    pendingStartupWarning = null
  }

  const p = createCoworkPersistence(invoke, {
    onThreadWritten: upsertThread,
    onThreadRemoved: (id) => {
      removeThread(id)
      // The conversation is gone: its persistent "could not be saved" warning
      // would otherwise linger forever.
      toast.dismiss(`cowork-missing-thread-${id}`)
    },
    onError: (id, e) => console.warn(`[cowork] write failed for ${id}:`, e),
    onThreadMissing: (id) => {
      // Keep the readable in-memory session (delete/export still work); it is
      // flagged so it is never written back or recreated from a stale snapshot.
      useCoworkSessions.setState((s) => ({
        sessions: s.sessions.map((x) => (x.id === id ? { ...x, unavailable: 'missing-thread' as const } : x)),
      }))
      toast.warning('A Cowork conversation could not be saved', {
        id: `cowork-missing-thread-${id}`,
        description: 'Its stored thread is missing, so changes are no longer saved. You can still read, export or delete it.',
        duration: Infinity,
      })
    },
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
  //    settled: while it is partial the live-id list is incomplete. The
  //    keep-list is the post-merge store state, not just `loaded`: a session
  //    created before hydration finished (merged as `early` above — e.g. a
  //    failed first start retried after the user began a run) has a live
  //    sandbox that the sweep must not delete.
  if (migrationSettled && loaded.sessions.length > 0) {
    void sweepSessionWorkspaces(
      useCoworkSessions.getState().sessions.map((s) => s.id)
    )
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
  pendingStartupWarning = null
}
