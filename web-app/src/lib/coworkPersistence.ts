import type { ThreadMessage } from '@janhq/core'
import type { CoworkSession } from '@/hooks/useCoworkSessions'
import {
  CODE_SESSIONS_KEY,
  COWORK_DELETED_IDS_KEY,
  COWORK_MIGRATED_IDS_KEY,
  COWORK_MIGRATION_ABANDONED_KEY,
  COWORK_SIDECAR,
  PERMANENT_ERROR_PREFIX,
  readAbandoned,
  readCoworkSessions,
  readDeletedIds,
  readIds,
  sameJson,
  sessionToSidecar,
  type CoworkSidecar,
  type Invoke,
} from '@/lib/migrateCoworkSessions'
import {
  coworkSessionToThreadMessages,
  defaultAnchorMs,
  transcriptFromThreadMessages,
  type CoworkTranscript,
} from '@/lib/coworkThreadMessages'

/**
 * Persistence for Cowork sessions stored as threads (`metadata.mode =
 * "cowork"`): `thread.json` for the list fields, `messages.jsonl` for the
 * transcript, `cowork.json` for the rest of the session state.
 *
 * Protocol:
 * - One serialized write queue per session; a newer snapshot never races an
 *   older one. Writes are debounced; `flush()` awaits queued AND in-flight work.
 * - A failed write keeps the session dirty and retries; nothing is dropped.
 * - First commit is sidecar, messages, `thread.json` last. Later writes go
 *   messages, sidecar, then `thread.json`, which is a read-modify-write that
 *   spreads the metadata already on disk.
 * - Deleting tombstones the id first: pending timers are cancelled, an
 *   in-flight write is drained, late writes for the id are dropped, then the
 *   thread directory is deleted. The backend refuses sidecar writes for a thread
 *   with no `thread.json`, so a straggler cannot resurrect it.
 * - messages.jsonl is the transcript authority: the provider-facing records
 *   (`coworkSessionToThreadMessages`, which the CLI, search and extensions
 *   read) with the whole transcript carried verbatim on the last record. The
 *   `cowork.json` sidecar (v2) holds the rest of the session state. Threads
 *   the migration or an older build wrote keep a v1 sidecar with the
 *   transcript arrays until their next write; `storedSession` resolves the two.
 * - A session never persisted and still empty is not written; a persisted
 *   session that becomes empty (/clear, rewind) IS written.
 * - Sessions flagged `unavailable` are shown but never written back.
 */

export const COWORK_CURRENT_ID_KEY = 'cowork_current_id'

/** The metadata keys Cowork owns or reads; any other key must round-trip. */
type ThreadMetadata = {
  mode?: string
  folder?: string | null
  folderAccess?: string
  project?: CoworkSession['project']
  planMode?: boolean
  goal?: CoworkSession['goal']
  cleared?: boolean
  migratedFrom?: {
    store: string
    updated?: number
    leftOut?: { skipped: number; unreadable: number }
  }
  messagesAnchorMs?: number
  titleSetManually?: boolean
  is_favorite?: boolean
  order?: number
  [key: string]: unknown
}

/**
 * A thread record as the backend stores it. Only the fields Cowork reads are
 * typed; everything else must round-trip untouched, hence the index signature.
 */
export type ThreadRecord = {
  id: string
  title?: string
  created?: number
  updated?: number
  assistants?: Array<{
    model?: { id?: string; engine?: string }
    [key: string]: unknown
  }>
  metadata?: ThreadMetadata
  [key: string]: unknown
}

const toSeconds = (ms: number) => (ms > 1e12 ? Math.floor(ms / 1000) : ms)

// A cleared session was used: it is never a droppable blank placeholder.
const isEmpty = (s: CoworkSession) =>
  !s.cleared && (s.turns?.length ?? 0) === 0 && (s.messages?.length ?? 0) === 0

/**
 * The thread record for a session. `existing` is the record already on disk:
 * its other fields and metadata keys (order, is_favorite, ...) are preserved
 * and `created` is never rewritten.
 */
export function sessionToThreadRecord(
  s: CoworkSession,
  existing?: ThreadRecord,
  legacy = false
): ThreadRecord & { metadata: ThreadMetadata } {
  const seconds = toSeconds(s.updated)
  const metadata: ThreadMetadata = {
    ...(existing?.metadata ?? {}),
    mode: 'cowork',
    folder: s.folder ?? null,
  }
  if (s.folderAccess) metadata.folderAccess = s.folderAccess
  else delete metadata.folderAccess
  // `project` can also be assigned from the shared thread list, which the
  // session store does not see: only a session that carries the key (a set or
  // an explicit clear) owns it.
  if (s.project !== undefined) metadata.project = s.project
  else if ('project' in s) delete metadata.project
  if (s.planMode !== undefined) metadata.planMode = s.planMode
  else delete metadata.planMode
  if (s.goal !== undefined) metadata.goal = s.goal
  else delete metadata.goal
  if (s.cleared) metadata.cleared = true
  else delete metadata.cleared
  if (legacy && !metadata.migratedFrom) {
    metadata.migratedFrom = { store: CODE_SESSIONS_KEY, updated: s.updated }
  }
  // Anchor of the messages.jsonl stamps: fixed on the first write-through (or
  // taken from what the migration used, see `loadCoworkSessions`) and kept, so
  // later turns never move the stamps of earlier messages.
  if (typeof metadata.messagesAnchorMs !== 'number') {
    metadata.messagesAnchorMs = defaultAnchorMs(s)
  }
  const assistant = existing?.assistants?.[0] ?? { id: 'model-only', name: 'Model' }
  return {
    ...(existing ?? {}),
    id: s.id,
    object: 'thread',
    // A rename made in the shared thread list wins over the session's title.
    title:
      metadata.titleSetManually === true && typeof existing?.title === 'string'
        ? existing.title
        : s.title,
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
  thread: ThreadRecord,
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
    ...((meta.folderAccess === 'read' || meta.folderAccess === 'write') && {
      folderAccess: meta.folderAccess as 'read' | 'write',
    }),
    ...(meta.project && { project: meta.project }),
    turns: sidecar?.turns ?? [],
    messages: sidecar?.messages ?? [],
    ...(sidecar?.history !== undefined && { history: sidecar.history }),
    ...(sidecar?.subagents !== undefined && { subagents: sidecar.subagents }),
    ...(sidecar?.lastUsage !== undefined && { lastUsage: sidecar.lastUsage }),
    ...(sidecar?.todos !== undefined && { todos: sidecar.todos }),
    ...(meta.planMode !== undefined && { planMode: meta.planMode }),
    ...(meta.goal !== undefined && { goal: meta.goal }),
    ...(meta.cleared === true && { cleared: true as const }),
    updated: updated * 1000,
    ...(unavailable && { unavailable }),
  }
}

/**
 * The sidecar a live write leaves once the transcript lives in messages.jsonl:
 * only the session state that is not part of the conversation. A v1 sidecar
 * (`sessionToSidecar`, what the migration and older builds write) still holds
 * the transcript arrays itself.
 */
type CoworkStateSidecar = {
  version: 2
  subagents?: CoworkSession['subagents']
  lastUsage?: CoworkSession['lastUsage']
  todos?: CoworkSession['todos']
}

function sessionToStateSidecar(s: CoworkSession): CoworkStateSidecar {
  return {
    version: 2,
    ...(s.subagents !== undefined && { subagents: s.subagents }),
    ...(s.lastUsage !== undefined && { lastUsage: s.lastUsage }),
    ...(s.todos !== undefined && { todos: s.todos }),
  }
}

type StoredSidecar = Partial<CoworkSidecar> | Partial<CoworkStateSidecar>

/**
 * Only consume a sidecar whose shape this build writes: v1 with array
 * `turns`/`messages` (every v1 writer has written both), or v2. Anything else,
 * a newer format from a future build after a downgrade, or a malformed v1,
 * must NOT load as an empty-but-writable session: the next touch (rename,
 * `updated` bump, /clear) would serialize an empty snapshot over the on-disk
 * bytes. Such sessions are contained as `unreadable-sidecar`: shown read-only,
 * never written back, bytes preserved. An older build sees a v2 sidecar the
 * same way, so a downgrade cannot overwrite a transcript it cannot find.
 */
function isConsumableSidecar(side: StoredSidecar): boolean {
  if (side.version === 2) return true
  const v1 = side as Partial<CoworkSidecar>
  return v1.version === 1 && Array.isArray(v1.turns) && Array.isArray(v1.messages)
}

/**
 * The stored session state, transcript included. Resolution is deterministic:
 * a transcript carried by the last messages.jsonl record wins (a live write
 * puts it there BEFORE the sidecar, so it is never older than the sidecar);
 * otherwise a v1 sidecar's own arrays (a migrated thread not yet written live,
 * or an older build's write, which replaces messages.jsonl without a carrier);
 * otherwise a v2 sidecar means an empty transcript.
 */
function storedSession(
  side: StoredSidecar,
  carried: CoworkTranscript | null
): Partial<CoworkSidecar> {
  const state = {
    ...(side.subagents !== undefined && { subagents: side.subagents }),
    ...(side.lastUsage !== undefined && { lastUsage: side.lastUsage }),
    ...(side.todos !== undefined && { todos: side.todos }),
  }
  if (carried) return { ...state, ...carried, version: 1 }
  if (side.version === 1) return side as Partial<CoworkSidecar>
  return { ...state, version: 1, turns: [], messages: [] }
}

/** Control flow only: the legacy blob does not need to be read. */
class SkipBlob extends Error {}

type LoadedCoworkSessions = {
  sessions: CoworkSession[]
  currentId: string | null
  /** Sessions sourced from the legacy `code-sessions` blob, not yet threads. */
  legacyIds: Set<string>
  /** Thread records of the sessions that are already persisted. */
  threads: ThreadRecord[]
  /**
   * Set when the deletion journal was unreadable and the legacy-blob merge was
   * therefore skipped (fail closed against resurrecting deleted sessions).
   * The caller must surface this: it hides legacy sessions on every launch
   * until the journal is repaired, and is silent data-hiding otherwise.
   */
  deletionJournalError?: string
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
  // The abandoned list is tiny and tells whether a settled migration still
  // leaves blob sessions to show. The blob itself can be huge, so it is only
  // read when it matters.
  let abandonedIds = new Set<string>()
  const abandonedErrors = new Map<string, string>()
  try {
    for (const a of readAbandoned(
      await invoke<string | null>('settings_get', {
        key: COWORK_MIGRATION_ABANDONED_KEY,
      })
    )) {
      abandonedErrors.set(a.id, a.error)
    }
    abandonedIds = new Set(abandonedErrors.keys())
  } catch (e) {
    console.warn('[cowork] could not read the abandoned list:', e)
  }
  const readBlob = !opts.migrationSettled || abandonedIds.size > 0
  const all = (await invoke<ThreadRecord[]>('list_threads')) ?? []
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
        const side = await invoke<StoredSidecar | null>('read_thread_extra', {
          threadId: t.id,
          name: COWORK_SIDECAR,
        })
        if (!side) return sessionFromThread(t, null, 'missing-sidecar')
        if (!isConsumableSidecar(side)) {
          console.warn(
            `[cowork] sidecar for ${t.id} has an unknown version or shape; showing it read-only`
          )
          return sessionFromThread(t, null, 'unreadable-sidecar')
        }
        // Read even beside a v1 sidecar: a live write that crashed before
        // rewriting the sidecar left the newer transcript only here. A failed
        // read lands in the catch below (read-only): loading the sidecar alone
        // could show, and then write back, an older transcript.
        const records = await invoke<Array<{ metadata?: unknown }>>(
          'list_messages',
          { threadId: t.id }
        )
        const session = sessionFromThread(
          t,
          storedSession(side, transcriptFromThreadMessages(records ?? []))
        )
        // A thread the migration created carries no anchor: its messages were
        // stamped from the session's exact `updated`. Record that on the
        // adopted record (in memory; the first write persists it) so the live
        // session keeps those stamps instead of re-stamping the whole log.
        if (typeof t.metadata?.messagesAnchorMs !== 'number') {
          const exact = t.metadata?.migratedFrom?.updated
          t.metadata = {
            ...(t.metadata ?? {}),
            messagesAnchorMs: defaultAnchorMs(
              session,
              typeof exact === 'number' ? exact : undefined
            ),
          }
        }
        return session
      } catch (e) {
        console.warn(`[cowork] unreadable sidecar for ${t.id}:`, e)
        return sessionFromThread(t, null, 'unreadable-sidecar')
      }
    })
  )

  const legacyIds = new Set<string>()
  let deletionJournalError: string | undefined
  try {
    if (!readBlob) throw new SkipBlob()
    const have = new Set(sessions.map((s) => s.id))
    const blob = readCoworkSessions(
      await invoke<string | null>('settings_get', { key: CODE_SESSIONS_KEY })
    )
    // A migrated id whose thread is gone was deleted by the user (in main
    // chat or here), so the untouched blob must not bring it back.
    const migratedIds = new Set(
      readIds(
        await invoke<string | null>('settings_get', {
          key: COWORK_MIGRATED_IDS_KEY,
        })
      )
    )
    // An abandoned id can never be written as a thread (an id another
    // conversation owns, an id the backend refuses). It stays visible so no
    // session silently disappears, but read-only: a save would fail forever.
    // Once the migration settled the blob is only consulted for sessions
    // the migration abandoned, so none of them silently disappears.
    const mergeable = blob.filter(
      (s) =>
        !have.has(s.id) &&
        !migratedIds.has(s.id) &&
        !isEmpty(s) &&
        (!opts.migrationSettled || abandonedIds.has(s.id))
    )
    // The journal is read (strictly) only when there is actually something
    // it could protect: with nothing mergeable, a corrupt journal must not
    // raise a false warning on every launch. With deletion intent
    // unreadable AND mergeable sessions present, the merge is skipped
    // entirely (fail closed against resurrection; committed threads still
    // load, the corrupt bytes are never rewritten) and the state is
    // reported to the caller so it is shown to the user, never hidden.
    if (mergeable.length > 0) {
      let deleted: Set<string> | null = null
      try {
        deleted = await readDeletedIds(invoke)
      } catch (e) {
        deletionJournalError = e instanceof Error ? e.message : String(e)
        console.warn(
          '[cowork] deletion journal unreadable; skipping the legacy sessions blob:',
          e
        )
      }
      if (deleted) {
        for (const s of mergeable) {
          if (deleted.has(s.id)) continue
          if (chatIds.has(s.id)) {
            sessions.push({ ...s, unavailable: 'id-collision' })
          } else if (abandonedIds.has(s.id)) {
            // No other conversation owns the id: the migration gave up on it
            // (a refused copy, too many failed launches). Say why, and let the
            // user export it or try again.
            sessions.push({
              ...s,
              unavailable: 'not-imported',
              importError: abandonedErrors.get(s.id),
            })
          } else {
            sessions.push(s)
            legacyIds.add(s.id)
          }
        }
      }
    }
  } catch (e) {
    if (!(e instanceof SkipBlob)) {
      console.warn('[cowork] skipping the legacy sessions blob:', e)
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

  return {
    sessions,
    currentId,
    legacyIds,
    threads: coworkThreads,
    ...(deletionJournalError !== undefined && { deletionJournalError }),
  }
}

/**
 * True only for the host's stable `thread_missing:` error (see
 * THREAD_MISSING_ERROR_CODE in src-tauri threads/commands.rs). Transient I/O
 * failures never carry it, so they keep the bounded dirty/retry path.
 */
/** thread.json metadata keys the shared thread list may edit on its own. */
const LIVE_METADATA_KEYS = [
  'is_favorite',
  'order',
  'project',
  'titleSetManually',
] as const

function isPermanentError(error: unknown): boolean {
  return toMessage(error).trimStart().startsWith(PERMANENT_ERROR_PREFIX)
}

export function isMissingThreadError(error: unknown): boolean {
  return toMessage(error).startsWith('thread_missing:')
}

// Tauri commands reject with a string or `{ message }`, plugins with an Error.
function toMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : ''
}

export type CoworkPersistence = {
  /** Record a new snapshot of a session; written after the debounce. */
  schedule(session: CoworkSession, opts?: { legacy?: boolean; allowEmpty?: boolean }): void
  /** Delete a session: tombstone, drain, then delete its thread. */
  remove(id: string, opts?: { recordDeleted?: boolean; preserveThread?: boolean }): Promise<void>
  setCurrentId(id: string | null): void
  /** Seed the known on-disk thread records after hydration. */
  adopt(threads: ThreadRecord[]): void
  isPersisted(id: string): boolean
  /** Drains queued/in-flight work; rejects if writes remain after bounded retries. */
  flush(): Promise<void>
  /**
   * Bounded, target-only drain: settles just this session's queued/in-flight
   * write (and its own pending deletion rollback). Never touches other sessions
   * or the current-id write; rejects if the target is still unwritten.
   */
  flushSession(id: string): Promise<void>
}

export function createCoworkPersistence(
  invoke: Invoke,
  opts: {
    debounceMs?: number
    retryMs?: number
    onThreadWritten?: (thread: ThreadRecord) => void
    onThreadRemoved?: (id: string) => void
    onError?: (id: string, error: unknown) => void
    /**
     * The host confirmed the session's thread no longer exists. Retries stop and
     * the in-memory snapshot is kept; the caller should mark it unavailable.
     */
    onThreadMissing?: (id: string, session: CoworkSession) => void
    /**
     * Held until it settles before any session that is still only in the
     * legacy blob is written. The background migration copies those sessions
     * into threads (and would overwrite a newer sidecar with the blob's older
     * one), so a write-through for the same id must land after it.
     */
    legacyGate?: Promise<unknown>
    /**
     * The freshest thread-list copy of a thread, in disk shape, so edits made
     * through the shared thread list are not reverted by the next write.
     */
    liveRecord?: (id: string) => Pick<ThreadRecord, 'title' | 'metadata'> | undefined
    /** The host permanently refuses this session's writes (`PERMANENT: ...`). */
    onWriteRefused?: (id: string, session: CoworkSession) => void
  } = {}
): CoworkPersistence {
  const debounceMs = opts.debounceMs ?? 400
  const retryMs = opts.retryMs ?? 3000

  const latest = new Map<string, { session: CoworkSession; legacy: boolean }>()
  const dirty = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const chains = new Map<string, Promise<void>>()
  // The last thread record THIS layer wrote (or adopted at hydration). The
  // write-through rebuilds thread.json from it, so an out-of-band edit to a
  // cowork thread between our writes would be reverted. Acceptable while this
  // layer is the only cowork thread writer in the process (single-instance
  // plugin; cowork rows expose no rename/favorite UI); a second writer would
  // need a re-read or a merge-on-live-record here (as the create-conflict
  // branch below already does).
  const persisted = new Map<string, ThreadRecord>()
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
          // The strict read means a mutation can never replace unreadable
          // deletion intent with an empty set.
          const ids = await readDeletedIds(invoke)
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

  // Sessions whose thread the host confirmed missing: never written again.
  const missing = new Set<string>()
  // Sessions the host permanently refuses to write: never written again.
  const refused = new Set<string>()

  let currentIdDirty = false
  let currentIdValue: string | null = null
  let currentIdTimer: ReturnType<typeof setTimeout> | null = null
  let currentIdChain: Promise<void> = Promise.resolve()

  // Dirty ids a flush must not report success over.
  const blocking = () => [...dirty]

  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t !== undefined) clearTimeout(t)
    timers.delete(id)
  }

  // The record on disk can also be edited from the shared thread list (rename,
  // favorite, order, project), which writes thread.json itself. Overlay the
  // freshest of those fields onto the record this layer last wrote, so the next
  // write-through does not revert them.
  const withLive = (id: string, existing: ThreadRecord | undefined) => {
    const live = existing ? opts.liveRecord?.(id) : undefined
    if (!existing || !live) return existing
    return {
      ...existing,
      ...(typeof live.title === 'string' && live.metadata?.titleSetManually === true
        ? { title: live.title }
        : {}),
      metadata: {
        ...(existing.metadata ?? {}),
        ...Object.fromEntries(
          LIVE_METADATA_KEYS.filter((k) => live.metadata && k in live.metadata).map(
            (k) => [k, live.metadata?.[k]]
          )
        ),
      },
    }
  }

  // What the last successful messages.jsonl write was built from. The records
  // are a pure function of these, so an unchanged transcript (a title or folder
  // edit) is not rewritten: a full rewrite per keystroke-sized change would
  // double the cost of every write.
  const written = new Map<
    string,
    {
      messages: CoworkSession['messages']
      turns: CoworkSession['turns']
      history: CoworkSession['history']
    }
  >()

  const scheduleRetry = (id: string, error: unknown) => {
    dirty.add(id)
    opts.onError?.(id, error)
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

  /**
   * Write the transcript into messages.jsonl, carried verbatim on the last
   * record (see `transcriptFromThreadMessages`). This is the transcript
   * authority, so any failure propagates and keeps the session dirty. Skipped
   * when the transcript is unchanged since the last write this session.
   */
  const writeMessages = async (
    id: string,
    session: CoworkSession,
    records: ThreadMessage[],
    create: boolean
  ) => {
    const last = written.get(id)
    if (
      !create &&
      last &&
      last.messages === session.messages &&
      last.turns === session.turns &&
      last.history === session.history
    ) {
      return
    }
    await invoke('replace_thread_messages', { threadId: id, messages: records, create })
    written.set(id, {
      messages: session.messages,
      turns: session.turns,
      history: session.history,
    })
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
      if (legacy && opts.legacyGate) await opts.legacyGate.catch(() => undefined)
      const existing = withLive(id, persisted.get(id))
      const record = sessionToThreadRecord(session, existing, legacy)
      // Stamped from the record's fixed anchor, not from the moving `updated`,
      // so appending never rewrites earlier message stamps.
      const records = coworkSessionToThreadMessages(session, {
        anchorMs: Number(record.metadata.messagesAnchorMs),
        carrier: true,
      })
      // A transcript with no record to ride on (only system notes, say) keeps
      // the v1 sidecar that holds the arrays itself.
      const carried =
        records.length > 0 ||
        ((session.turns?.length ?? 0) === 0 &&
          (session.messages?.length ?? 0) === 0 &&
          (session.history?.length ?? 0) === 0)
      const sidecar = carried ? sessionToStateSidecar(session) : sessionToSidecar(session)
      const writeSidecar = () =>
        invoke('write_thread_extra', {
          threadId: id,
          name: COWORK_SIDECAR,
          value: sidecar,
          create: !existing,
        })
      // Order. A new thread is sidecar first: the backend only lets a thread
      // directory it does not know be created by the sidecar's owner. An
      // existing one writes the transcript first, so a crash in between leaves
      // a carried transcript that is never older than the sidecar beside it
      // (which is what lets the loader prefer it). A v1 sidecar goes before its
      // emptied log for the same reason: the log's stale carrier would then
      // win, showing the previous write rather than an empty transcript.
      // Re-check the tombstone right before ANY write: a late flush after
      // delete must not recreate (`create: true`) a deleted session.
      if (tombstones.has(id)) return
      if (!existing || !carried) await writeSidecar()
      if (tombstones.has(id)) return
      await writeMessages(id, session, records, !existing)
      if (tombstones.has(id)) return
      if (existing && carried) await writeSidecar()
      if (tombstones.has(id)) return
      if (existing) {
        await invoke('modify_thread', { thread: record })
        persisted.set(id, record)
        opts.onThreadWritten?.(record)
      } else {
        const created = await invoke<ThreadRecord>('create_thread', { thread: record })
        if (created && !sameJson(created, record)) {
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
      // The host confirmed the thread is gone (not a transient failure). Never
      // recreate it (a deleted chat must not resurrect) and never retry: drop the
      // dirty flag so flush/close settle, keep the snapshot readable in memory.
      // A pending deletion keeps its normal tombstone/rollback handling instead.
      if (isMissingThreadError(e) && !tombstones.has(id)) {
        missing.add(id)
        dirty.delete(id)
        clearTimer(id)
        opts.onError?.(id, e)
        opts.onThreadMissing?.(id, session)
        return
      }
      // A PERMANENT refusal (an id the backend will never accept, a directory
      // that is someone else's) repeats forever: stop, keep the in-memory
      // snapshot, and let the caller flag the session read-only. Nothing on
      // disk is touched.
      if (isPermanentError(e) && !tombstones.has(id)) {
        refused.add(id)
        dirty.delete(id)
        clearTimer(id)
        opts.onError?.(id, e)
        opts.onWriteRefused?.(id, session)
        return
      }
      scheduleRetry(id, e)
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
      if ((tombstones.has(id) && !pendingRollbacks.has(id)) || session.unavailable || missing.has(id) || refused.has(id)) return
      if (!persisted.has(id) && isEmpty(session) && !o?.allowEmpty) return
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
      missing.delete(id)
      refused.delete(id)
      tombstones.add(id)
      clearTimer(id)
      dirty.delete(id)
      written.delete(id)
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
            const ids = await readDeletedIds(invoke)
            if (ids.has(id)) return
            ids.add(id)
            await invoke('settings_set', {
              key: COWORK_DELETED_IDS_KEY,
              value: JSON.stringify([...ids]),
            })
            journalAdded = true
            // settings.json is written on a debounce; the thread folder goes
            // right below. Put the journal on disk first, or a crash in between
            // lets the migration bring the session back on the next launch.
            await invoke('settings_flush')
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
        // A record this layer wrote is newer than any list read.
        if (typeof t?.id === 'string' && !persisted.has(t.id)) persisted.set(t.id, t)
      }
    },

    isPersisted: (id) => persisted.has(id),

    async flushSession(id) {
      // A target being deleted (or whose thread the host confirmed gone) must
      // never report success: the caller would start work on a doomed record.
      const assertUsable = () => {
        if (tombstones.has(id)) throw new Error(`Cowork session ${id} is being deleted or was deleted`)
        if (missing.has(id)) throw new Error(`Cowork session ${id} thread is missing`)
        if (refused.has(id)) throw new Error(`Cowork session ${id} cannot be written`)
      }
      if (pendingRollbacks.has(id)) await rollbackDeletion(id)
      assertUsable()
      for (let pass = 0; pass < 3; pass++) {
        if (dirty.has(id)) {
          clearTimer(id)
          enqueue(id)
        }
        await (chains.get(id) ?? Promise.resolve())
        assertUsable()
        if (!dirty.has(id)) return
      }
      throw new Error(`Cowork persistence flush failed; pending writes: ${id}`)
    },

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
        if (blocking().length === 0 && !currentIdDirty) return
      }
      // Keep snapshots, dirty flags and session retry timers intact: a later
      // flush (or background retry) must be able to recover without a new edit.
      const pending = [...blocking(), ...(currentIdDirty ? ['current-id'] : [])]
      throw new Error(`Cowork persistence flush failed; pending writes: ${pending.join(', ')}`)
    },
  }
}
