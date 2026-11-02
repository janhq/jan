import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import type { CoworkSession } from '@/hooks/useCoworkSessions'

/**
 * One-time copy of Cowork sessions (`code-sessions` in settings.json) into
 * threads with `metadata.mode = "cowork"`.
 *
 * Rules (see plans/merge-chat-cowork-data-model.md, D4):
 * - Copy, never move: `code-sessions` is left untouched as the rollback source.
 * - Idempotent and resumable. `thread.json` is the commit marker and is written
 *   LAST; a directory holding only the sidecar is not committed and is redone.
 * - A thread id that already exists and is not a migrated Cowork thread is a
 *   collision: it is reported, never overwritten, and keeps the marker unset.
 * - The completion marker is set only when every session migrated. Failures
 *   never throw into app startup; they are returned.
 * - Talks to the backend commands directly. `DefaultThreadsService.createThread`
 *   swallows errors and would hide a failed write.
 */

export const CODE_SESSIONS_KEY = 'code-sessions'
export const COWORK_MIGRATION_FLAG_KEY = 'cowork_threads_migrated_v1'
export const COWORK_SIDECAR = 'cowork'
/** Ids the user deleted while the migration was unsettled, so the untouched
 * legacy blob can never resurrect them. */
export const COWORK_DELETED_IDS_KEY = 'cowork_deleted_ids'

export type Invoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
) => Promise<T>

export type CoworkMigrationResult = {
  status: 'already-migrated' | 'nothing-to-migrate' | 'complete' | 'partial'
  migrated: string[]
  skipped: string[]
  failed: { id: string; error: string }[]
}

/** The transcript payload stored beside thread.json, losslessly. */
export type CoworkSidecar = {
  version: 1
  turns: CoworkSession['turns']
  messages: CoworkSession['messages']
  history?: CoworkSession['history']
  subagents?: CoworkSession['subagents']
  lastUsage?: CoworkSession['lastUsage']
  todos?: CoworkSession['todos']
}

type StoredThread = {
  id?: unknown
  metadata?: { mode?: unknown } | null
}

// Key-order-insensitive serialization: the backend may reorder object keys.
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
 * Deletion intent is load-bearing: an unreadable journal must never read as
 * "nothing was deleted", or merging the untouched legacy blob resurrects
 * sessions the user deleted. Throws on an unreadable or invalid journal so
 * every caller fails closed (migration stays `partial` and retries; the load
 * path skips the legacy-blob merge). A missing journal is an empty set.
 */
export async function readDeletedIds(invoke: Invoke): Promise<Set<string>> {
  const raw = await invoke<string | null>('settings_get', {
    key: COWORK_DELETED_IDS_KEY,
  })
  // Only an absent key is an empty journal. An empty string is NOT: every
  // writer stores at least '[]', so '' can only be a damaged value, and
  // reading it as empty could resurrect deleted sessions (the write path
  // additionally must never replace it with a fresh empty set).
  const parsed: unknown = raw == null ? [] : JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error('Invalid Cowork deletion journal: expected an array of strings')
  }
  return new Set(parsed)
}

const toErrorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Parse the zustand-persist envelope `{state:{sessions}, version}`. Version-0
 * sessions have no `messages`; rebuild them from `turns` as the store's own
 * `migrate` does, leaving `history` as it was.
 */
export function readCoworkSessions(raw: string | null): CoworkSession[] {
  if (!raw) return []
  const parsed = JSON.parse(raw) as { state?: { sessions?: CoworkSession[] } }
  const sessions = parsed?.state?.sessions
  if (!Array.isArray(sessions)) return []
  return sessions.map((s) =>
    s.messages
      ? s
      : { ...s, messages: coworkTurnsToUIMessages(s.turns ?? [], s.id) }
  )
}

export function sessionToSidecar(s: CoworkSession): CoworkSidecar {
  return {
    version: 1,
    turns: s.turns ?? [],
    messages: s.messages ?? [],
    ...(s.history !== undefined && { history: s.history }),
    ...(s.subagents !== undefined && { subagents: s.subagents }),
    ...(s.lastUsage !== undefined && { lastUsage: s.lastUsage }),
    ...(s.todos !== undefined && { todos: s.todos }),
  }
}

export function sessionToThread(s: CoworkSession) {
  // Cowork stores `updated` in ms, threads in seconds. Sessions carry no
  // creation time, so `created` is the last update.
  const seconds = s.updated > 1e12 ? Math.floor(s.updated / 1000) : s.updated
  return {
    id: s.id,
    object: 'thread',
    title: s.title,
    assistants: [
      {
        id: 'model-only',
        name: 'Model',
        model: {
          id: s.model?.id ?? '*',
          engine: s.model?.provider ?? 'llamacpp',
        },
      },
    ],
    created: seconds,
    updated: seconds,
    metadata: {
      mode: 'cowork',
      folder: s.folder ?? null,
      ...(s.planMode !== undefined && { planMode: s.planMode }),
      ...(s.goal !== undefined && { goal: s.goal }),
      migratedFrom: { store: CODE_SESSIONS_KEY, updated: s.updated },
    },
  }
}

const isEmptySession = (s: CoworkSession) =>
  (s.turns?.length ?? 0) === 0 && (s.messages?.length ?? 0) === 0

export async function migrateCoworkSessionsToThreads(
  invoke: Invoke
): Promise<CoworkMigrationResult> {
  const result: CoworkMigrationResult = {
    status: 'complete',
    migrated: [],
    skipped: [],
    failed: [],
  }

  try {
    const flag = await invoke<string | null>('settings_get', {
      key: COWORK_MIGRATION_FLAG_KEY,
    })
    if (flag === 'true') return { ...result, status: 'already-migrated' }

    const sessions = readCoworkSessions(
      await invoke<string | null>('settings_get', { key: CODE_SESSIONS_KEY })
    )
    const nonEmpty = sessions.filter((s) => !isEmptySession(s))
    result.skipped = sessions.filter(isEmptySession).map((s) => s.id)

    if (nonEmpty.length === 0) {
      // Nothing was ever written (stable never enabled Cowork): just record
      // it. Deliberately decided BEFORE the strict journal read: with nothing
      // to migrate there is nothing a corrupt journal could resurrect, and
      // failing here would wrongly keep the migration partial forever
      // (blocking deletions and the sweep) for users with no legacy data.
      await invoke('settings_set', { key: COWORK_MIGRATION_FLAG_KEY, value: 'true' })
      return { ...result, status: 'nothing-to-migrate' }
    }

    // thread.json is the commit marker, so "already migrated" is decided from
    // the committed threads, never from a directory that may hold a lone sidecar.
    const existing = new Map<string, StoredThread>()
    for (const t of await invoke<StoredThread[]>('list_threads')) {
      if (typeof t?.id === 'string') existing.set(t.id, t)
    }

    // Already-committed sessions need no deletion intent either (skipping a
    // copy can never resurrect anything). Deciding them BEFORE the strict
    // journal read matters for one crash window: a previous launch that
    // copied every session but died before writing the flag must settle here
    // even with a corrupt journal, or deletions stay blocked with no warning.
    const alreadyCommitted = (s: CoworkSession) =>
      existing.get(s.id)?.metadata?.mode === 'cowork'
    const uncommitted = nonEmpty.filter((s) => !alreadyCommitted(s))
    result.skipped.push(...nonEmpty.filter(alreadyCommitted).map((s) => s.id))

    if (uncommitted.length === 0) {
      await invoke('settings_set', { key: COWORK_MIGRATION_FLAG_KEY, value: 'true' })
      return result
    }

    // Uncommitted candidates exist, so deletion intent is load-bearing from
    // here on: the strict read throws on a corrupt journal and the run stays
    // partial (fail closed; the corrupt bytes are never rewritten).
    const deleted = await readDeletedIds(invoke)
    const candidates = uncommitted.filter((s) => !deleted.has(s.id))

    if (candidates.length === 0) {
      // Every uncommitted session was deliberately deleted; nothing to copy.
      await invoke('settings_set', { key: COWORK_MIGRATION_FLAG_KEY, value: 'true' })
      return { ...result, status: 'nothing-to-migrate' }
    }

    for (const session of candidates) {
      try {
        const committed = existing.get(session.id)
        if (committed) {
          // A cowork thread with this id is already ours: it was either copied
          // by an earlier run or written through by the Cowork store (same id
          // by construction). Anything else is a different conversation.
          if (committed.metadata?.mode === 'cowork') {
            result.skipped.push(session.id)
            continue
          }
          throw new Error('a different conversation already uses this id')
        }

        const sidecar = sessionToSidecar(session)
        await invoke('write_thread_extra', {
          threadId: session.id,
          name: COWORK_SIDECAR,
          value: sidecar,
          // The thread directory does not exist yet; creating it is allowed here.
          create: true,
        })
        const back = await invoke<unknown>('read_thread_extra', {
          threadId: session.id,
          name: COWORK_SIDECAR,
        })
        if (canonical(back) !== canonical(sidecar)) {
          throw new Error('sidecar did not read back identically')
        }

        // Commit: thread.json last.
        const created = await invoke<StoredThread>('create_thread', {
          thread: sessionToThread(session),
        })
        if (created?.id !== session.id) {
          throw new Error('backend assigned a different thread id')
        }
        result.migrated.push(session.id)
      } catch (e) {
        result.failed.push({ id: session.id, error: toErrorMessage(e) })
      }
    }

    if (result.failed.length > 0) {
      console.warn('[cowork-migration] some sessions failed; will retry next launch', result.failed)
      return { ...result, status: 'partial' }
    }
    await invoke('settings_set', { key: COWORK_MIGRATION_FLAG_KEY, value: 'true' })
    return result
  } catch (e) {
    console.warn('[cowork-migration] failed; will retry next launch:', e)
    return {
      ...result,
      status: 'partial',
      failed: [...result.failed, { id: '*', error: toErrorMessage(e) }],
    }
  }
}

/**
 * Whether the session-scope sandbox sweep may run: only once the migration has
 * finished, or when there was never a `code-sessions` blob to migrate.
 */
export async function isCoworkMigrationSettled(invoke: Invoke): Promise<boolean> {
  const flag = await invoke<string | null>('settings_get', {
    key: COWORK_MIGRATION_FLAG_KEY,
  })
  return flag === 'true'
}
