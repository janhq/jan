import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { isCoworkThread } from '@/lib/threadMode'

/**
 * One history for every conversation: chat threads (outside projects) and
 * Cowork sessions in a single list, newest first.
 */

type Row =
  | { kind: 'chat'; id: string; updated: number; thread: Thread }
  | { kind: 'cowork'; id: string; updated: number; session: CoworkSession }

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
): Row[] {
  const rows: Row[] = []
  for (const thread of threads) {
    if (isCoworkThread(thread)) continue
    const project = thread.metadata?.project
    if (project && (projectIds === null || projectIds.has(project.id))) continue
    rows.push({
      kind: 'chat',
      id: thread.id,
      updated: toSeconds(thread.updated || 0),
      thread,
    })
  }
  for (const session of sessions) {
    // Same rule as chat rows: a session in a real project is listed under
    // that project (its mirror thread), not twice. The one exception is a
    // session whose mirror thread is gone ('missing-thread'): nothing lists
    // it under the project, so history is its only way in. The other
    // unavailable reasons still have their mirror thread listed.
    const sessionProject = session.project
    if (sessionProject && session.unavailable !== 'missing-thread' && (projectIds === null || projectIds.has(sessionProject.id))) continue
    // A session earns a row once it has messages. A first run's turns are
    // transient until committed, so a streaming session stays listed too.
    if (session.turns.length === 0 && runIds[session.id] == null && !session.unavailable && !session.cleared) {
      continue
    }
    rows.push({
      kind: 'cowork',
      id: session.id,
      updated: toSeconds(session.updated || 0),
      session,
    })
  }
  return rows.sort((a, b) => b.updated - a.updated)
}
