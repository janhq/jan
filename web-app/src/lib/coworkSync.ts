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
export async function flushCowork(): Promise<void> {
  await persistence?.flush()
}

export function startCoworkSync(): Promise<void> {
  if (!isPlatformTauri()) return Promise.resolve()
  startPromise ??= doStart().catch((e) => {
    console.warn('[cowork] sync failed to start; Cowork stays in memory only:', e)
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
        void (async () => {
          await p.remove(id, { recordDeleted: !migrationSettled })
          await cleanupThreadWorkspace(id, 'session')
        })()
      }
    }
    prev = state
  })

  // 6. Flush when the app is hidden or closed.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void p.flush()
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => void p.flush())
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().onCloseRequested(async () => {
        // Awaiting here holds the close until every queued and in-flight write
        // has settled; a failure must not trap the user in an unclosable window.
        try {
          await p.flush()
        } catch (e) {
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
  unsubscribe?.()
  unsubscribe = null
  persistence = null
  startPromise = null
  migrationSettled = false
}
