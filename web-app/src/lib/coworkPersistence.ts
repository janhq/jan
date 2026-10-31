import type { CoworkSession } from '@/hooks/useCoworkSessions'
import {
  CODE_SESSIONS_KEY,
  COWORK_DELETED_IDS_KEY,
  COWORK_SIDECAR,
  readCoworkSessions,
  readDeletedIds,
  sessionToSidecar,
  type CoworkSidecar,
  type Invoke,
} from '@/lib/migrateCoworkSessions'

/**
 * Persistence for Cowork sessions stored as threads (`metadata.mode =
 * "cowork"`): `thread.json` for the list fields, `cowork.json` for the
 * transcript. See plans/merge-chat-cowork-data-model.md, phase 2 (A1-A14,
 * F1-F12).
 *
 * Protocol:
 * - One serialized write queue per session; a newer snapshot never races an
 *   older one. Writes are debounced; `flush()` awaits queued AND in-flight work.
 * - A failed write keeps the session dirty and retries; nothing is dropped.
 * - First commit is sidecar-first, `thread.json` last. Later writes go sidecar
 *   then `thread.json`, which is a read-modify-write that spreads the metadata
 *   already on disk.
 * - Deleting tombstones the id first: pending timers are cancelled, an
 *   in-flight write is drained, late writes for the id are dropped, then the
 *   thread directory is deleted. The backend refuses sidecar writes for a thread
 *   with no `thread.json`, so a straggler cannot resurrect it.
 * - A session never persisted and still empty is not written; a persisted
 *   session that becomes empty (/clear, rewind) IS written.
 * - Sessions flagged `unavailable` are shown but never written back.
 */

export const COWORK_CURRENT_ID_KEY = 'cowork_current_id'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

const toSeconds = (ms: number) => (ms > 1e12 ? Math.floor(ms / 1000) : ms)

const isEmpty = (s: CoworkSession) =>
  (s.turns?.length ?? 0) === 0 && (s.messages?.length ?? 0) === 0

// Key-order-insensitive comparison (the backend may reorder object keys).
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : val
  )
}

/**
 * The thread record for a session. `existing` is the record already on disk:
 * its other fields and metadata keys (order, is_favorite, ...) are preserved
 * and `created` is never rewritten.
 */
export function sessionToThreadRecord(
  s: CoworkSession,
  existing?: Json,
  legacy = false
): Json {
  const seconds = toSeconds(s.updated)
  const metadata: Json = {
    ...(existing?.metadata ?? {}),
    mode: 'cowork',
    folder: s.folder ?? null,
  }
  if (s.project !== undefined) metadata.project = s.project
  else delete metadata.project
  if (s.planMode !== undefined) metadata.planMode = s.planMode
  else delete metadata.planMode
  if (s.goal !== undefined) metadata.goal = s.goal
  else delete metadata.goal
  if (legacy && !metadata.migratedFrom) {
    metadata.migratedFrom = { store: CODE_SESSIONS_KEY, updated: s.updated }
  }
  const assistant = existing?.assistants?.[0] ?? { id: 'model-only', name: 'Model' }
  return {
    ...(existing ?? {}),
    id: s.id,
    object: 'thread',
    title: s.title,
    assistants: [
      {
        ...assistant,
        model: {
          id: s.model?.id ?? '*',
          engine: s.model?.provider ?? 'llamacpp',
        },
      },
    ],
    created: existing?.created ?? seconds,
    updated: seconds,
    metadata,
  }
}

/** Rebuild a session from its thread record and sidecar. */
export function sessionFromThread(
  thread: Json,
  sidecar: Partial<CoworkSidecar> | null,
  unavailable?: CoworkSession['unavailable']
): CoworkSession {
  const model = thread.assistants?.[0]?.model
  const meta = thread.metadata ?? {}
  const updated = typeof thread.updated === 'number' ? thread.updated : 0
  return {
    id: String(thread.id),
    title: typeof thread.title === 'string' ? thread.title : 'New session',
    model:
      model && model.id && model.id !== '*'
        ? { id: String(model.id), provider: String(model.engine ?? 'llamacpp') }
        : undefined,
    folder: typeof meta.folder === 'string' ? meta.folder : null,
    ...(meta.project && { project: meta.project }),
    turns: sidecar?.turns ?? [],
    messages: sidecar?.messages ?? [],
    ...(sidecar?.history !== undefined && { history: sidecar.history }),
    ...(sidecar?.subagents !== undefined && { subagents: sidecar.subagents }),
    ...(sidecar?.lastUsage !== undefined && { lastUsage: sidecar.lastUsage }),
    ...(sidecar?.todos !== undefined && { todos: sidecar.todos }),
    ...(meta.planMode !== undefined && { planMode: meta.planMode }),
    ...(meta.goal !== undefined && { goal: meta.goal }),
    updated: updated * 1000,
    ...(unavailable && { unavailable }),
  }
}

export type LoadedCoworkSessions = {
  sessions: CoworkSession[]
  currentId: string | null
  /** Sessions sourced from the legacy `code-sessions` blob, not yet threads. */
  legacyIds: Set<string>
  /** Thread records of the sessions that are already persisted. */
  threads: Json[]
}

/**
 * Read every Cowork session. One `list_threads` is the source of truth. While
 * the migration is unsettled, sessions still only in the legacy blob are added
 * so a failed migration never makes a session disappear.
 */
export async function loadCoworkSessions(
  invoke: Invoke,
  opts: { migrationSettled: boolean }
): Promise<LoadedCoworkSessions> {
  const all = (await invoke<Json[]>('list_threads')) ?? []
  const coworkThreads = all.filter(
    (t) => typeof t?.id === 'string' && t.metadata?.mode === 'cowork'
  )
  const chatIds = new Set(
    all
      .filter((t) => typeof t?.id === 'string' && t.metadata?.mode !== 'cowork')
      .map((t) => t.id as string)
  )

  const sessions: CoworkSession[] = await Promise.all(
    coworkThreads.map(async (t) => {
      try {
        const side = await invoke<CoworkSidecar | null>('read_thread_extra', {
          threadId: t.id,
          name: COWORK_SIDECAR,
        })
        return side
          ? sessionFromThread(t, side)
          : sessionFromThread(t, null, 'missing-sidecar')
      } catch (e) {
        console.warn(`[cowork] unreadable sidecar for ${t.id}:`, e)
        return sessionFromThread(t, null, 'unreadable-sidecar')
      }
    })
  )

  const legacyIds = new Set<string>()
  if (!opts.migrationSettled) {
    try {
      const have = new Set(sessions.map((s) => s.id))
      const deleted = await readDeletedIds(invoke)
      const blob = readCoworkSessions(
        await invoke<string | null>('settings_get', { key: CODE_SESSIONS_KEY })
      )
      for (const s of blob) {
        if (have.has(s.id) || deleted.has(s.id) || isEmpty(s)) continue
        if (chatIds.has(s.id)) {
          sessions.push({ ...s, unavailable: 'id-collision' })
        } else {
          sessions.push(s)
          legacyIds.add(s.id)
        }
      }
    } catch (e) {
      console.warn('[cowork] could not read the legacy sessions blob:', e)
    }
  }

  sessions.sort((a, b) => b.updated - a.updated)

  let currentId: string | null = null
  try {
    const saved = await invoke<string | null>('settings_get', {
      key: COWORK_CURRENT_ID_KEY,
    })
    if (saved && sessions.some((s) => s.id === saved)) currentId = saved
  } catch {
    /* resume is best effort */
  }

  return { sessions, currentId, legacyIds, threads: coworkThreads }
}

/** Journal mutations must never replace unreadable deletion intent with an empty set. */
async function readDeletedIdsStrict(invoke: Invoke): Promise<Set<string>> {
  const raw = await invoke<string | null>('settings_get', {
    key: COWORK_DELETED_IDS_KEY,
  })
  const parsed: unknown = raw == null ? [] : JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error('Invalid Cowork deletion journal: expected an array of strings')
  }
  return new Set(parsed)
}

export type CoworkPersistence = {
  /** Record a new snapshot of a session; written after the debounce. */
  schedule(session: CoworkSession, opts?: { legacy?: boolean }): void
  /** Delete a session: tombstone, drain, then delete its thread. */
  remove(id: string, opts?: { recordDeleted?: boolean; preserveThread?: boolean }): Promise<void>
  setCurrentId(id: string | null): void
  /** Seed the known on-disk thread records after hydration. */
  adopt(threads: Json[]): void
  isPersisted(id: string): boolean
  /** Drains queued/in-flight work; rejects if writes remain after bounded retries. */
  flush(): Promise<void>
}

export function createCoworkPersistence(
  invoke: Invoke,
  opts: {
    debounceMs?: number
    retryMs?: number
    onThreadWritten?: (thread: Json) => void
    onThreadRemoved?: (id: string) => void
    onError?: (id: string, error: unknown) => void
  } = {}
): CoworkPersistence {
  const debounceMs = opts.debounceMs ?? 400
  const retryMs = opts.retryMs ?? 3000

  const latest = new Map<string, { session: CoworkSession; legacy: boolean }>()
  const dirty = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const chains = new Map<string, Promise<void>>()
  const persisted = new Map<string, Json>()
  const tombstones = new Set<string>()
  // Failed compensation stays queued until flush (no background busy-loop).
  // Keep its tombstone until the durable deletion intent really is removed.
  const pendingRollbacks = new Set<string>()

  let deletionJournalChain: Promise<void> = Promise.resolve()
  const updateDeletionJournal = (update: () => Promise<void>) => {
    const next = deletionJournalChain.then(update)
    deletionJournalChain = next.catch(() => {})
    return next
  }

  const rollbackDeletion = async (id: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await updateDeletionJournal(async () => {
          if (!pendingRollbacks.has(id)) return
          // Re-read in the shared queue so concurrent deletions are preserved.
          const ids = await readDeletedIdsStrict(invoke)
          ids.delete(id)
          await invoke('settings_set', {
            key: COWORK_DELETED_IDS_KEY,
            value: JSON.stringify([...ids]),
          })
          pendingRollbacks.delete(id)
          tombstones.delete(id)
        })
        return
      } catch (error) {
        if (attempt === 2) throw error
      }
    }
  }

  let currentIdDirty = false
  let currentIdValue: string | null = null
  let currentIdTimer: ReturnType<typeof setTimeout> | null = null
  let currentIdChain: Promise<void> = Promise.resolve()

  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t !== undefined) clearTimeout(t)
    timers.delete(id)
  }

  const writeOnce = async (id: string) => {
    if (tombstones.has(id)) {
      if (pendingRollbacks.has(id)) return
      dirty.delete(id)
      return
    }
    if (!dirty.has(id)) return
    const entry = latest.get(id)
    if (!entry) {
      dirty.delete(id)
      return
    }
    // A mutation that lands while this write is in flight re-marks the id dirty
    // and queues the next write behind this one.
    dirty.delete(id)
    const { session, legacy } = entry
    try {
      const existing = persisted.get(id)
      const record = sessionToThreadRecord(session, existing, legacy)
      await invoke('write_thread_extra', {
        threadId: id,
        name: COWORK_SIDECAR,
        value: sessionToSidecar(session),
        create: !existing,
      })
      if (tombstones.has(id)) return
      if (existing) {
        await invoke('modify_thread', { thread: record })
        persisted.set(id, record)
        opts.onThreadWritten?.(record)
      } else {
        const created = await invoke<Json>('create_thread', { thread: record })
        if (created && canonical(created) !== canonical(record)) {
          // The thread already existed on disk (e.g. migrated earlier): apply
          // this snapshot on top of what is there.
          const merged = sessionToThreadRecord(session, created, legacy)
          await invoke('modify_thread', { thread: merged })
          persisted.set(id, merged)
          opts.onThreadWritten?.(merged)
        } else {
          persisted.set(id, record)
          opts.onThreadWritten?.(record)
        }
      }
    } catch (e) {
      dirty.add(id)
      opts.onError?.(id, e)
      if (!timers.has(id) && !tombstones.has(id)) {
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id)
            enqueue(id)
          }, retryMs)
        )
      }
    }
  }

  const enqueue = (id: string): Promise<void> => {
    const next = (chains.get(id) ?? Promise.resolve()).then(() => writeOnce(id))
    chains.set(id, next)
    return next
  }

  const writeCurrentId = async () => {
    if (!currentIdDirty) return
    currentIdDirty = false
    try {
      if (currentIdValue) {
        await invoke('settings_set', {
          key: COWORK_CURRENT_ID_KEY,
          value: currentIdValue,
        })
      } else {
        await invoke('settings_remove', { key: COWORK_CURRENT_ID_KEY })
      }
    } catch (e) {
      currentIdDirty = true
      opts.onError?.('current-id', e)
    }
  }

  const enqueueCurrentId = () => {
    currentIdChain = currentIdChain.then(writeCurrentId)
    return currentIdChain
  }

  return {
    schedule(session, o) {
      const id = session.id
      if ((tombstones.has(id) && !pendingRollbacks.has(id)) || session.unavailable) return
      if (!persisted.has(id) && isEmpty(session)) return
      const prev = latest.get(id)
      latest.set(id, { session, legacy: o?.legacy ?? prev?.legacy ?? false })
      dirty.add(id)
      clearTimer(id)
      // The sync layer restores failed removals immediately. Retain that
      // snapshot, but do not write it or claim recovery before compensation.
      if (pendingRollbacks.has(id)) return
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          enqueue(id)
        }, debounceMs)
      )
    },

    async remove(id, o) {
      if (pendingRollbacks.has(id)) await rollbackDeletion(id)
      tombstones.add(id)
      clearTimer(id)
      dirty.delete(id)
      const snapshot = latest.get(id)
      latest.delete(id)
      await (chains.get(id) ?? Promise.resolve())
      let journalAdded = false
      let deletionCompleted = false
      try {
        // Record durable intent before deleting files. The key is shared by
        // every session, so serialize read-modify-write across bulk removals.
        if (o?.recordDeleted) {
          await updateDeletionJournal(async () => {
            const ids = await readDeletedIdsStrict(invoke)
            if (ids.has(id)) return
            ids.add(id)
            await invoke('settings_set', {
              key: COWORK_DELETED_IDS_KEY,
              value: JSON.stringify([...ids]),
            })
            journalAdded = true
          })
        }
        if (!o?.preserveThread) await invoke('delete_thread', { threadId: id })
        deletionCompleted = true
        persisted.delete(id)
        if (!o?.preserveThread) opts.onThreadRemoved?.(id)
      } catch (e) {
        if (journalAdded && !deletionCompleted) {
          pendingRollbacks.add(id)
          try {
            // Undo only this removal's new intent, not a pre-existing marker.
            await rollbackDeletion(id)
          } catch (rollbackError) {
            if (snapshot && !latest.has(id)) {
              latest.set(id, snapshot)
              dirty.add(id)
            }
            const error = new Error(`${String(e)}; deletion recovery pending: ${String(rollbackError)}`)
            opts.onError?.(id, error)
            throw error
          }
        }
        // The authoritative store can restore the session and retry deletion.
        // Pending compensation instead retains edits and its tombstone above.
        tombstones.delete(id)
        opts.onError?.(id, e)
        throw e
      }
    },

    setCurrentId(id) {
      currentIdValue = id
      currentIdDirty = true
      if (currentIdTimer) clearTimeout(currentIdTimer)
      currentIdTimer = setTimeout(() => {
        currentIdTimer = null
        enqueueCurrentId()
      }, debounceMs)
    },

    adopt(threads) {
      for (const t of threads) {
        if (typeof t?.id === 'string') persisted.set(t.id, t)
      }
    },

    isPersisted: (id) => persisted.has(id),

    async flush() {
      // A flush must not report success with failed recovery still queued.
      // Each call makes bounded attempts; storage failure never spins forever.
      await Promise.all([...pendingRollbacks].map((id) => rollbackDeletion(id)))
      await deletionJournalChain
      for (let pass = 0; pass < 3; pass++) {
        for (const id of [...dirty]) {
          clearTimer(id)
          enqueue(id)
        }
        // Include writes already in flight even when they temporarily cleared
        // their dirty flag. Failures re-mark it before the next pass.
        await Promise.all([...chains.values()])
        if (currentIdTimer) {
          clearTimeout(currentIdTimer)
          currentIdTimer = null
        }
        await enqueueCurrentId()
        if (dirty.size === 0 && !currentIdDirty) return
      }
      // Keep snapshots, dirty flags and session retry timers intact: a later
      // flush (or background retry) must be able to recover without a new edit.
      const pending = [...dirty, ...(currentIdDirty ? ['current-id'] : [])]
      throw new Error(`Cowork persistence flush failed; pending writes: ${pending.join(', ')}`)
    },
  }
}
