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
  runIds: Record<string, unknown>
): Row[] {
  const rows: Row[] = []
  for (const thread of threads) {
    if (thread.metadata?.project || isCoworkThread(thread)) continue
    rows.push({
      kind: 'chat',
      id: thread.id,
      updated: toSeconds(thread.updated || 0),
      thread,
    })
  }
  for (const session of sessions) {
    // A session earns a row once it has messages. A first run's turns are
    // transient until committed, so a streaming session stays listed too.
    if (session.turns.length === 0 && runIds[session.id] == null && !session.unavailable) {
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
