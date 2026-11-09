import type { CoworkSession } from '@/hooks/useCoworkSessions'

/**
 * One history for every conversation, newest first.
 *
 * Chat and Cowork conversations are both threads: a Cowork session is written
 * through to a thread (see coworkSync) and mirrored into the shared thread
 * list, so every persisted conversation is listed ONCE, from `threads`. The
 * session store only contributes a row for what has no thread yet (a first run
 * that is still streaming, turns not yet mirrored) or whose thread is gone
 * (an unavailable session, which history is the only way to reach and delete).
 */

export type HistoryRow =
  | { kind: 'thread'; id: string; updated: number; thread: Thread }
  | { kind: 'session'; id: string; updated: number; session: CoworkSession }

// Threads store seconds, Cowork sessions milliseconds. Sort on one unit.
const toSeconds = (n: number) => (n > 1e12 ? n / 1000 : n)

export function mergeHistory(
  threads: Thread[],
  sessions: CoworkSession[],
  runIds: Record<string, unknown>,
  // Ids of the projects that exist. A thread is left out of the history only
  // when its project is real (it is listed under that project instead); one
  // pointing at a missing project would otherwise be unreachable from the
  // sidebar. `null` means the project list has not loaded yet, so every
  // project thread stays hidden rather than flashing in and out.
  projectIds: ReadonlySet<string> | null = null
): HistoryRow[] {
  const inProject = (project: { id: string } | undefined) =>
    Boolean(project) && (projectIds === null || projectIds.has((project as { id: string }).id))

  const threadIds = new Set<string>()
  const rows: HistoryRow[] = []
  for (const thread of threads) {
    threadIds.add(thread.id)
    if (inProject(thread.metadata?.project)) continue
    rows.push({
      kind: 'thread',
      id: thread.id,
      updated: toSeconds(thread.updated || 0),
      thread,
    })
  }

  for (const session of sessions) {
    // Dedupe by id: a session that already has its thread is that thread's row.
    // The one exception is an `id-collision` placeholder, which shares its id
    // with an unrelated chat thread and is a conversation of its own.
    if (threadIds.has(session.id) && session.unavailable !== 'id-collision') continue
    // Same rule as thread rows: a session in a real project is listed under
    // that project (through its mirror thread), not here. The exception is a
    // session whose mirror thread is gone ('missing-thread'): nothing lists it
    // under the project, so history is its only way in.
    if (
      session.unavailable !== 'missing-thread' &&
      inProject(session.project)
    ) {
      continue
    }
    // A session earns a row once it has messages. A first run's turns are
    // transient until committed, so a streaming session stays listed too.
    if (
      session.turns.length === 0 &&
      runIds[session.id] == null &&
      !session.unavailable &&
      !session.cleared
    ) {
      continue
    }
    rows.push({
      kind: 'session',
      id: session.id,
      updated: toSeconds(session.updated || 0),
      session,
    })
  }
  return rows.sort((a, b) => b.updated - a.updated)
}
