import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import { coworkSessionToThreadMessages } from '@/lib/coworkThreadMessages'
import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  isPlatformAndroid,
  isPlatformIOS,
  isPlatformTauri,
} from '@/lib/platform/utils'

/**
 * One-time copy of Cowork sessions (`code-sessions` in settings.json) into
 * threads with `metadata.mode = "cowork"`.
 *
 * Rules:
 * - Copy, never move: `code-sessions` is left untouched as the rollback source.
 * - Idempotent and resumable. `thread.json` is the commit marker and is written
 *   LAST; a directory holding only the sidecar and messages is not committed
 *   and is redone.
 * - The transcript is converted to main chat's messages.jsonl records and
 *   written with `replace_thread_messages` (replace, not append) before the
 *   commit. The conversion is a pure function of the session, so a retry after
 *   a crash rewrites identical bytes and the prompt prefix stays stable.
 * - A thread id that already exists and is not a migrated Cowork thread is a
 *   collision: it is reported and never overwritten. Such permanent failures
 *   are recorded under COWORK_MIGRATION_ABANDONED_KEY and not retried.
 * - The completion marker is set once every session has either migrated or been
 *   abandoned. Transient failures keep it unset so the next launch retries.
 *   Failures never throw into app startup; they are returned.
 * - Talks to the backend commands directly. `DefaultThreadsService.createThread`
 *   swallows errors and would hide a failed write.
 * - No deletion journal: on this build the Cowork store removes a deleted
 *   session from `code-sessions` itself, so a deleted session is never in the
 *   blob this reads and nothing can be resurrected from it.
 */

export const CODE_SESSIONS_KEY = 'code-sessions'
export const COWORK_MIGRATION_FLAG_KEY = 'cowork_threads_migrated_v1'
export const COWORK_SIDECAR = 'cowork'
/**
 * Sessions that can never migrate (an id taken by another conversation, an id
 * the backend refuses). Remembering them lets the completion marker settle
 * instead of redoing the same work on every launch. Transient errors (disk,
 * backend not ready) are never recorded here and are retried.
 */
export const COWORK_MIGRATION_ABANDONED_KEY =
  'cowork_threads_migration_abandoned_v1'

export type Invoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
) => Promise<T>

export type CoworkMigrationResult = {
  status: 'already-migrated' | 'nothing-to-migrate' | 'complete' | 'partial'
  migrated: string[]
  skipped: string[]
  /** Permanent failures: reported, remembered, never retried. */
  abandoned: { id: string; error: string }[]
  /** Transient failures: the marker stays unset and the next launch retries. */
  failed: { id: string; error: string }[]
}

/** A failure retrying cannot fix. */
class PermanentMigrationError extends Error {}

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

// Mirrors validate_thread_id in src-tauri/src/core/threads/utils.rs.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|(com|lpt)\d)$/i
export function isValidThreadId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(id) &&
    !WINDOWS_DEVICE.test(id.split('.')[0])
  )
}

// Backend refusals that will repeat on every launch.
const isPermanentBackendError = (e: unknown) =>
  /refusing to overwrite its messages|Invalid thread id/.test(toErrorMessage(e))

const toErrorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e)

function readAbandoned(raw: string | null): { id: string; error: string }[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(
          (a): a is { id: string; error: string } =>
            typeof a?.id === 'string' && typeof a?.error === 'string'
        )
      : []
  } catch {
    return []
  }
}

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
    abandoned: [],
    failed: [],
  }
  const markDone = () =>
    invoke('settings_set', { key: COWORK_MIGRATION_FLAG_KEY, value: 'true' })

  try {
    const flag = await invoke<string | null>('settings_get', {
      key: COWORK_MIGRATION_FLAG_KEY,
    })
    if (flag === 'true') return { ...result, status: 'already-migrated' }

    const sessions = readCoworkSessions(
      await invoke<string | null>('settings_get', { key: CODE_SESSIONS_KEY })
    )
    const previouslyAbandoned = readAbandoned(
      await invoke<string | null>('settings_get', {
        key: COWORK_MIGRATION_ABANDONED_KEY,
      })
    )
    const nonEmpty = sessions.filter((s) => !isEmptySession(s))
    result.skipped = sessions.filter(isEmptySession).map((s) => s.id)

    if (nonEmpty.length === 0) {
      // Nothing was ever written (stable never enabled Cowork): just record it.
      await markDone()
      return { ...result, status: 'nothing-to-migrate' }
    }

    // thread.json is the commit marker, so "already migrated" is decided from
    // the committed threads, never from a directory that may hold a lone sidecar.
    const existing = new Map<string, StoredThread>()
    for (const t of await invoke<StoredThread[]>('list_threads')) {
      if (typeof t?.id === 'string') existing.set(t.id, t)
    }

    const newlyAbandoned: { id: string; error: string }[] = []
    for (const session of nonEmpty) {
      const before = previouslyAbandoned.find((a) => a.id === session.id)
      if (before) {
        result.abandoned.push(before)
        continue
      }
      try {
        if (!isValidThreadId(session.id)) {
          throw new PermanentMigrationError(
            `session id ${JSON.stringify(session.id)} is not a valid thread id`
          )
        }
        const committed = existing.get(session.id)
        if (committed) {
          // A cowork thread with this id is already ours (copied by an earlier
          // run). Anything else is a different conversation.
          if (committed.metadata?.mode === 'cowork') {
            result.skipped.push(session.id)
            continue
          }
          throw new PermanentMigrationError(
            'a different conversation already uses this id'
          )
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

        // The transcript main chat opens the thread with. Replace, not
        // append: a retry after a crash here must not duplicate it.
        const messages = coworkSessionToThreadMessages(session)
        await invoke('replace_thread_messages', {
          threadId: session.id,
          messages,
          create: true,
        })
        const stored = await invoke<unknown>('list_messages', {
          threadId: session.id,
        })
        if (canonical(stored) !== canonical(messages)) {
          throw new Error('messages did not read back identically')
        }

        // Commit: thread.json last.
        const created = await invoke<StoredThread>('create_thread', {
          thread: sessionToThread(session),
        })
        if (created?.id !== session.id) {
          throw new PermanentMigrationError(
            'backend assigned a different thread id'
          )
        }
        result.migrated.push(session.id)
      } catch (e) {
        const entry = { id: String(session.id), error: toErrorMessage(e) }
        if (e instanceof PermanentMigrationError || isPermanentBackendError(e)) {
          result.abandoned.push(entry)
          newlyAbandoned.push(entry)
        } else {
          result.failed.push(entry)
        }
      }
    }

    if (newlyAbandoned.length > 0) {
      console.warn(
        '[cowork-migration] sessions that cannot be migrated; not retrying',
        newlyAbandoned
      )
      await invoke('settings_set', {
        key: COWORK_MIGRATION_ABANDONED_KEY,
        value: JSON.stringify([...previouslyAbandoned, ...newlyAbandoned]),
      })
    }

    if (result.failed.length > 0) {
      console.warn(
        '[cowork-migration] some sessions failed; will retry next launch',
        result.failed
      )
      return { ...result, status: 'partial' }
    }
    await markDone()
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
 * Startup entry point: runs the migration through the service hub's backend
 * `invoke`, the same seam `migrateLocalStorageToBackend` uses. On web there is
 * no backend and no `code-sessions` blob in it, so nothing runs; mobile is
 * skipped too. It never
 * throws: a failed migration stays unflagged and is retried next launch, and
 * must not stop the app from rendering. Returns `null` when it did not run.
 */
export async function migrateCoworkSessionsOnStartup(): Promise<CoworkMigrationResult | null> {
  if (!isPlatformTauri()) return null
  // Sidecars and message replacement are file-backed and desktop-only; mobile
  // stores threads in SQLite and Cowork does not exist there.
  if (isPlatformIOS() || isPlatformAndroid()) return null
  try {
    const core = getServiceHub().core()
    return await migrateCoworkSessionsToThreads(core.invoke.bind(core) as Invoke)
  } catch (e) {
    console.warn('[cowork-migration] could not start; will retry next launch:', e)
    return null
  }
}
