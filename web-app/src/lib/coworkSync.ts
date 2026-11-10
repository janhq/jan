import { toast } from 'sonner'
import { i18n } from '@/i18n/react-i18next-compat'
import {
  quiesceChats,
  resumeChatsAfterPreventedClose,
  withChatCloseDeadline,
} from '@/lib/chatClose'
import {
  quiesceCoworkRuns,
  resumeCoworkAfterPreventedClose,
  __resetCoworkRunCloseForTests,
} from '@/hooks/useCoworkRun'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import { flushMessageWrites } from '@/hooks/useMessages'
import { getServiceHub } from '@/hooks/useServiceHub'
import { discardStaleCoworkHandoffs } from '@/lib/coworkHandoff'
import {
  isPlatformAndroid,
  isPlatformIOS,
  isPlatformTauri,
} from '@/lib/platform/utils'
import {
  createCoworkPersistence,
  loadCoworkSessions,
  type CoworkPersistence,
  type ThreadRecord,
} from '@/lib/coworkPersistence'
import {
  COWORK_MIGRATION_ABANDONED_KEY,
  COWORK_MIGRATION_ATTEMPTS_KEY,
  COWORK_MIGRATION_FLAG_KEY,
  isCoworkMigrationSettled,
  migrateCoworkSessionsOnStartup,
  readAbandoned,
  readDeletedIds,
  type CoworkMigrationResult,
  type Invoke,
} from '@/lib/migrateCoworkSessions'
import { cleanupThreadWorkspace } from '@/lib/agentTools'

/**
 * Connects the Cowork session store to thread storage.
 *
 * Startup, in order: migrate legacy `code-sessions` -> threads (bounded wait),
 * load Cowork threads, MERGE them into the store (sessions created in the
 * meantime are kept), mirror them into the shared thread list, then start
 * write-through. Write-through is not running while the store is being
 * hydrated, so loading never writes anything back.
 *
 * The legacy blob stays alive (it is the rollback source and is never edited),
 * so two rules keep it from fighting the threads:
 * - a session deleted while the blob can still be read is recorded in the
 *   `cowork_deleted_ids` journal, which both the migration and the loader honor;
 * - a legacy session that is edited before the background migration reaches it
 *   is written only after that migration settles (`legacyGate`), so the copy of
 *   the older blob never overwrites the newer write-through.
 */

/**
 * How long startup waits for the Cowork migration. Past it the app renders and
 * the migration keeps running; the sessions are re-loaded when it finishes.
 */
export const COWORK_MIGRATION_BUDGET_MS = 3000

let persistence: CoworkPersistence | null = null
let unsubscribe: (() => void) | null = null
let startPromise: Promise<void> | null = null
let migrationSettled = false
const pendingDeletes = new Set<Promise<void>>()
let deleteFailure: unknown = null
let pendingStartupWarning: (() => void) | null = null
let closeListenersInstalled = false
let closeFailures = 0
const CLOSE_FAILED_TOAST_ID = 'cowork-close-failed'

/**
 * Consecutive failed close attempts (a storage error or the 10 s deadline)
 * after which the failure toast offers to close without saving.
 */
export const COWORK_CLOSE_FAILURES_BEFORE_FORCE = 3

/**
 * Re-raise startup warnings once a sonner `<Toaster>` is mounted. Sonner drops
 * toasts created before its Toaster subscribes, and startup warnings are
 * raised while the providers still gate rendering on startup itself, so the
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
function upsertThread(thread: ThreadRecord) {
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
    isFavorite: thread.metadata?.is_favorite ?? existing?.isFavorite,
    order: thread.metadata?.order ?? existing?.order,
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

/** Await in-flight Cowork deletions (used before the window closes). */
export async function flushCoworkDeletes(): Promise<void> {
  if (startPromise) await startPromise
  await Promise.all([...pendingDeletes])
  if (deleteFailure) {
    const failure = deleteFailure
    deleteFailure = null
    throw failure
  }
}

/** Everything the window must drain before it may go away. */
function flushAllWrites(): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled([
    // Queued and in-flight Cowork writes.
    persistence?.flush(),
    flushCoworkDeletes(),
    flushMessageWrites(),
  ])
}

/** Cowork needs the desktop host (native folder dialog, sandboxed tools). */
export const supportsCowork = () =>
  isPlatformTauri() && !isPlatformIOS() && !isPlatformAndroid()

/** Resolves with the work's outcome, or with `'timeout'` after `ms`. */
async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start (once) the Cowork <-> thread sync. Safe to call from several places:
 * later callers share the running start; a failed start is forgotten so the
 * next call retries. Never rejects for a failed migration, only for a failure
 * to load or wire up the store.
 */
export function startCoworkSync(): Promise<void> {
  if (!supportsCowork()) return Promise.resolve()
  startPromise ??= doStart().catch((e) => {
    startPromise = null
    console.warn('[cowork] sync failed to start; operations must retry initialization:', e)
    throw e
  })
  return startPromise
}

async function doStart() {
  const invoke = getInvoke()

  // 1. One-time, idempotent copy of legacy sessions into threads. It never
  //    throws. Startup waits for it only for a bounded time: a huge history
  //    must not keep the app from rendering. Past the budget the rest finishes
  //    in the background and the sessions are re-loaded when it does.
  const migration = migrateCoworkSessionsOnStartup().catch(() => null)
  const outcome = await withinBudget(migration, COWORK_MIGRATION_BUDGET_MS)
  const background = outcome === 'timeout' ? migration : null
  migrationSettled = await settledAfter(invoke, outcome)

  // 2. Load. An unsettled migration keeps legacy-only sessions visible.
  const loaded = await loadCoworkSessions(invoke, { migrationSettled })

  // Failing closed on an unreadable deletion journal must not hide data
  // silently: legacy sessions stay hidden and their deletion stays blocked on
  // EVERY launch until the journal is repaired, so warn persistently on every
  // launch. Never auto-repair, quarantine, or drop the journal: rewriting it
  // could resurrect sessions the user deleted.
  if (loaded.deletionJournalError) {
    const warn = () =>
      toast.warning(i18n.t('common:coworkSync.journalUnreadableTitle'), {
        id: 'cowork-deletion-journal-unreadable',
        duration: Infinity,
        description: i18n.t('common:coworkSync.journalUnreadableDescription'),
      })
    // This startup gates provider render, so the Toaster is usually NOT mounted
    // yet and sonner drops toasts created before it subscribes. Fire now for an
    // already-mounted toaster AND keep the warning for the post-mount flush;
    // the stable id makes double delivery idempotent.
    pendingStartupWarning = warn
    warn()
  } else {
    pendingStartupWarning = null
  }

  const p = createCoworkPersistence(invoke, {
    legacyGate: background ?? undefined,
    liveRecord: (id) => {
      const t = useThreads.getState().threads[id]
      if (!t) return undefined
      return {
        title: t.title,
        metadata: {
          ...(t.metadata ?? {}),
          is_favorite: t.isFavorite,
          order: t.order,
        },
      }
    },
    onThreadWritten: upsertThread,
    onThreadRemoved: (id) => {
      removeThread(id)
      // The conversation is gone: its persistent warning would otherwise linger.
      toast.dismiss(`cowork-missing-thread-${id}`)
      toast.dismiss(`cowork-write-refused-${id}`)
    },
    onError: (id, e) => console.warn(`[cowork] write failed for ${id}:`, e),
    onThreadMissing: (id) => {
      // Keep the readable in-memory session (delete/export still work); it is
      // flagged so it is never written back or recreated from a stale snapshot.
      markUnavailable(id, 'missing-thread')
      toast.warning(i18n.t('common:coworkSync.missingThreadTitle'), {
        id: `cowork-missing-thread-${id}`,
        description: i18n.t('common:coworkSync.missingThreadDescription'),
        duration: Infinity,
      })
    },
    onWriteRefused: (id) => {
      // The backend permanently refuses this id: show it read-only instead of
      // retrying forever.
      markUnavailable(id, 'id-collision')
      toast.warning(i18n.t('common:coworkSync.writeRefusedTitle'), {
        id: `cowork-write-refused-${id}`,
        description: i18n.t('common:coworkSync.writeRefusedDescription'),
        duration: Infinity,
      })
    },
  })
  p.adopt(loaded.threads)
  persistence = p

  // Ids the store ever held from here on: a session absent from the store that
  // was present at some point was deleted meanwhile and must not be re-added by
  // the background reload.
  const seen = new Set<string>()
  for (const s of useCoworkSessions.getState().sessions) seen.add(s.id)

  // 3. Merge: sessions created before hydration finished are kept, and win
  //    over the loaded copy of the same id (the store is newer than the disk).
  mergeLoaded(loaded.sessions, loaded.currentId)
  for (const s of loaded.sessions) seen.add(s.id)

  // Cowork conversations also live in the shared thread list so search and the
  // sidebar see them. Do this once; later writes upsert through onThreadWritten.
  for (const t of loaded.threads) upsertThread(t)

  // A first prompt handed over from the home composer for a session that no
  // longer exists (reload before its first commit) must not linger.
  try {
    discardStaleCoworkHandoffs(
      new Set(useCoworkSessions.getState().sessions.map((x) => x.id))
    )
  } catch {
    /* sessionStorage unavailable */
  }

  // 4. Write-through from here on.
  let prev = useCoworkSessions.getState()
  const legacyIds = loaded.legacyIds
  p.setCurrentId(prev.currentId)
  unsubscribe?.()
  unsubscribe = useCoworkSessions.subscribe((state) => {
    if (state.currentId !== prev.currentId) p.setCurrentId(state.currentId)
    if (state.sessions !== prev.sessions) {
      const { changed, removed } = diff(prev.sessions, state.sessions)
      for (const s of changed) {
        seen.add(s.id)
        p.schedule(s, { legacy: legacyIds.has(s.id) })
      }
      for (const id of removed) {
        const snapshot = prev.sessions.find((session) => session.id === id)
        // Neither placeholder owns what sits under its id: a collision shares
        // it with an unrelated chat, and a session the migration gave up on may
        // have been refused because threads/<id> holds files of its own.
        const placeholder =
          snapshot?.unavailable === 'id-collision' ||
          snapshot?.unavailable === 'not-imported'
        const removal = (async () => {
          await p.remove(id, {
            // While the legacy blob can still be read, deletion intent must
            // survive in the journal or the blob brings the session back. An
            // abandoned legacy session stays in the blob forever, so it is
            // journaled even after the migration settled.
            recordDeleted: !migrationSettled || placeholder,
            // Never delete a thread or workspace a placeholder does not own.
            preserveThread: placeholder,
          })
          // Workspace reclamation cannot turn a successful durable deletion back
          // into a visible session. It is best-effort and retried by the sweep.
          if (!placeholder) await cleanupThreadWorkspace(id)
        })()
        pendingDeletes.add(removal)
        void removal
          .catch((error) => {
            deleteFailure = error
            if (snapshot) {
              useCoworkSessions.setState((current) => ({
                sessions: current.sessions.some((session) => session.id === id)
                  ? current.sessions
                  : [...current.sessions, snapshot],
              }))
            }
            console.warn(`[cowork] delete failed for ${id}:`, error)
          })
          .finally(() => pendingDeletes.delete(removal))
      }
    }
    prev = state
  })

  // 5. The migration overran its budget: when it finishes, bring in what it
  //    created.
  if (background) {
    void background
      .then((late) => finishLateMigration(invoke, late, seen))
      .catch((error) => {
        console.warn('[cowork] reload after the background migration failed:', error)
      })
  }

  // 6. Flush when the app is hidden or closed.
  await installCloseHandlers()
}

/** Settled = the legacy blob never needs to be read again. */
async function settledAfter(
  invoke: Invoke,
  outcome: CoworkMigrationResult | null | 'timeout'
): Promise<boolean> {
  if (outcome === 'timeout') return false
  if (outcome && outcome.status !== 'partial') return true
  try {
    return await isCoworkMigrationSettled(invoke)
  } catch {
    return false
  }
}

function markUnavailable(id: string, reason: NonNullable<CoworkSession['unavailable']>) {
  useCoworkSessions.setState((s) => ({
    sessions: s.sessions.map((x) => (x.id === id ? { ...x, unavailable: reason } : x)),
  }))
}

/** Merge loaded sessions under whatever the store already holds. */
function mergeLoaded(loaded: CoworkSession[], loadedCurrentId: string | null) {
  useCoworkSessions.setState((s) => {
    const have = new Set(s.sessions.map((x) => x.id))
    const sessions = [...s.sessions, ...loaded.filter((x) => !have.has(x.id))].sort(
      (a, b) => b.updated - a.updated
    )
    const currentId =
      s.currentId && sessions.some((x) => x.id === s.currentId)
        ? s.currentId
        : loadedCurrentId
    return { sessions, currentId }
  })
}

/**
 * The background migration finished after startup. Re-read the threads: it
 * created the ones that were still legacy-only. The store is already newer than
 * the disk, so only sessions it does not hold are added, and never one the user
 * deleted meanwhile (`seen`). A thread the migration created for a session
 * deleted in the meantime (the deletion landed between its journal read and its
 * commit) is removed here, because the journal is authoritative.
 */
async function finishLateMigration(
  invoke: Invoke,
  late: CoworkMigrationResult | null,
  seen: Set<string>
) {
  migrationSettled = await settledAfter(invoke, late)
  const p = persistence
  if (!p) return
  const loaded = await loadCoworkSessions(invoke, { migrationSettled })
  let deleted = new Set<string>()
  try {
    deleted = await readDeletedIds(invoke)
  } catch {
    // Unreadable journal: the load already warned; add nothing that is deleted-looking.
  }
  const inStore = new Set(useCoworkSessions.getState().sessions.map((x) => x.id))
  for (const t of loaded.threads) {
    if (typeof t?.id === 'string' && deleted.has(t.id) && !inStore.has(t.id)) {
      // Resurrected by the migration against a recorded deletion.
      void p.remove(t.id, { recordDeleted: false }).catch((error) => {
        console.warn(`[cowork] could not remove ${t.id} after the migration:`, error)
      })
    }
  }
  p.adopt(loaded.threads)
  const fresh = loaded.sessions.filter(
    (s) => !inStore.has(s.id) && !seen.has(s.id) && !deleted.has(s.id)
  )
  if (fresh.length > 0) mergeLoaded(fresh, null)
  for (const t of loaded.threads) {
    if (!deleted.has(t.id) && (!seen.has(t.id) || inStore.has(t.id))) upsertThread(t)
  }
}

export type CoworkImportRetry =
  | { imported: true }
  | { imported: false; error: string }

/**
 * Try again to import one session the migration gave up on (`not-imported`).
 * Its abandoned entry and attempt count are cleared and the migration runs
 * again; it skips everything already migrated, so only this session (and any
 * other still-pending one) is copied. On success the placeholder is replaced by
 * the imported thread; on failure it stays, with the new error.
 */
export async function retryCoworkImport(
  id: string
): Promise<CoworkImportRetry> {
  await startCoworkSync()
  const invoke = getInvoke()
  const abandoned = readAbandoned(
    await invoke<string | null>('settings_get', {
      key: COWORK_MIGRATION_ABANDONED_KEY,
    })
  ).filter((a) => a.id !== id)
  await invoke('settings_set', {
    key: COWORK_MIGRATION_ABANDONED_KEY,
    value: JSON.stringify(abandoned),
  })
  const rawAttempts = await invoke<string | null>('settings_get', {
    key: COWORK_MIGRATION_ATTEMPTS_KEY,
  })
  if (rawAttempts) {
    try {
      const attempts = JSON.parse(rawAttempts) as Record<string, number>
      delete attempts[id]
      await invoke('settings_set', {
        key: COWORK_MIGRATION_ATTEMPTS_KEY,
        value: JSON.stringify(attempts),
      })
    } catch {
      // An unreadable count only means this session starts again from 0.
    }
  }
  // Until this run settles the legacy blob is live again: deletions journal.
  migrationSettled = false
  await invoke('settings_remove', { key: COWORK_MIGRATION_FLAG_KEY })
  const result = await migrateCoworkSessionsOnStartup()
  migrationSettled = await settledAfter(invoke, result)

  if (result?.migrated.includes(id)) {
    const loaded = await loadCoworkSessions(invoke, { migrationSettled })
    const thread = loaded.threads.find((t) => t.id === id)
    const session = loaded.sessions.find((s) => s.id === id)
    if (thread && session) {
      persistence?.adopt([thread])
      useCoworkSessions.setState((s) => ({
        sessions: s.sessions.map((x) => (x.id === id ? session : x)),
      }))
      upsertThread(thread)
      return { imported: true }
    }
  }
  const error =
    result?.abandoned.find((a) => a.id === id)?.error ??
    result?.failed.find((f) => f.id === id || f.id === '*')?.error ??
    'unknown error'
  useCoworkSessions.setState((s) => ({
    sessions: s.sessions.map((x) =>
      x.id === id ? { ...x, importError: error } : x
    ),
  }))
  return { imported: false, error }
}

/**
 * Whether Rust hides the main window on this close instead of closing it
 * (`main_window_hides_on_close`). On error assume a real close: that path
 * saves everything before the window goes.
 */
async function hidesOnClose(): Promise<boolean> {
  try {
    return (await getInvoke()<boolean>('main_window_hides_on_close')) === true
  } catch (e) {
    console.warn('[cowork] could not read the close behaviour:', e)
    return false
  }
}

async function installCloseHandlers() {
  if (closeListenersInstalled) return
  closeListenersInstalled = true
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushAllWrites().then((writes) => {
          const failed = writes.find((r) => r.status === 'rejected')
          if (failed?.status === 'rejected') {
            console.warn('[cowork] background flush failed:', failed.reason)
          }
        })
      }
    })
  }
  if (typeof window === 'undefined') return
  window.addEventListener('beforeunload', () => {
    void flushAllWrites().then((writes) => {
      const failed = writes.find((r) => r.status === 'rejected')
      if (failed?.status === 'rejected') {
        console.warn('[cowork] unload flush failed:', failed.reason)
      }
    })
  })
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.onCloseRequested(async (event) => {
      // When Rust only hides the window (macOS, or the background API server
      // on Windows/Linux) the app keeps running: keep live runs going, save in
      // the background, and prevent the destroy() that would quit the app.
      if (await hidesOnClose()) {
        event.preventDefault()
        void flushAllWrites().then((writes) => {
          const failed = writes.find((r) => r.status === 'rejected')
          if (failed?.status === 'rejected') {
            console.warn('[cowork] flush on hide failed:', failed.reason)
          }
        })
        return
      }
      // A real close quits the app. Awaiting here holds it until every queued
      // and in-flight write has settled. On failure keep the window (and the
      // unsaved state) alive; another close request retries storage rather
      // than losing the run.
      if (await saveBeforeExit()) return
      event.preventDefault()
      reportExitSaveFailure('close', () => {
        // destroy() skips the close-requested event that would block it.
        void appWindow.destroy().catch((error) => {
          console.warn('[cowork] could not close the window:', error)
        })
      })
    })
    // Quit (tray, Cmd+Q): Rust holds the exit until this answers.
    await appWindow.listen('app-exit-requested', async () => {
      const invoke = getInvoke()
      if (await saveBeforeExit()) {
        await invoke('exit_after_save')
        return
      }
      await invoke('cancel_exit_save')
      reportExitSaveFailure('quit', () => {
        void invoke('exit_after_save').catch((error) => {
          console.warn('[cowork] could not quit:', error)
        })
      })
    })
  } catch (e) {
    console.warn('[cowork] could not register the close handler:', e)
  }
}

/**
 * Stop live runs and save every pending write before the app exits. A live run
 * has not committed its transcript or wire history yet: stop it and await its
 * final commit BEFORE draining storage, or the last turn would be written after
 * the flush. Still flush the other sessions if one participant fails to settle
 * cleanly. Returns false (runs resumed) when anything could not be saved.
 */
async function saveBeforeExit(): Promise<boolean> {
  try {
    await withChatCloseDeadline(
      (async () => {
        const runs = await Promise.allSettled([quiesceCoworkRuns(), quiesceChats()])
        const writes = await flushAllWrites()
        const failed = [...runs, ...writes].find((r) => r.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      })()
    )
    closeFailures = 0
    toast.dismiss(CLOSE_FAILED_TOAST_ID)
    return true
  } catch (e) {
    resumeCoworkAfterPreventedClose()
    resumeChatsAfterPreventedClose()
    console.warn('[cowork] flush on close failed:', e)
    return false
  }
}

/**
 * Keeping the app open is the default (data loss is worse than a stuck
 * window), but the user must always see why it did not close or quit, and
 * after repeated failures get an explicit way out that names the cost.
 */
function reportExitSaveFailure(kind: 'close' | 'quit', force: () => void) {
  closeFailures += 1
  const canForce = closeFailures >= COWORK_CLOSE_FAILURES_BEFORE_FORCE
  toast.error(i18n.t('common:coworkSync.closeFailedTitle'), {
    id: CLOSE_FAILED_TOAST_ID,
    duration: Infinity,
    description: i18n.t(
      canForce
        ? 'common:coworkSync.closeForceDescription'
        : kind === 'quit'
          ? 'common:coworkSync.quitFailedDescription'
          : 'common:coworkSync.closeFailedDescription'
    ),
    action: canForce
      ? {
          label: i18n.t(
            kind === 'quit' ? 'common:coworkSync.quitAnyway' : 'common:coworkSync.closeAnyway'
          ),
          onClick: force,
        }
      : undefined,
  })
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
  closeListenersInstalled = false
  closeFailures = 0
}
