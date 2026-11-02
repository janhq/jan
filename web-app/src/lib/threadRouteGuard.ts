import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { isCoworkThread } from '@/lib/threadMode'

/**
 * Decides whether `/threads/$threadId` must hand the conversation to the
 * Cowork view instead of mounting the writable chat view.
 *
 * Two invariants (integrated persistence review R2/R3):
 *
 * - An `id-collision` placeholder marks a legacy Cowork session whose id is
 *   owned by a REAL chat thread. The chat keeps its route; the placeholder
 *   stays reachable at `/cowork/$sessionId` only. Every other session —
 *   including the other unavailable placeholders, which the Cowork view
 *   renders read-only — claims the route as before.
 *
 * - A thread committed with `metadata.mode === 'cowork'` never mounts the
 *   chat view, even when the session store holds no matching session (failed
 *   `startCoworkSync` hydration renders routes over an empty store). Mounting
 *   chat there forks the transcript into `messages.jsonl`, invisible to the
 *   Cowork view. Redirecting instead is safe: with an empty store the Cowork
 *   route falls back home without creating or writing anything.
 *
 * Pure on its inputs so the decision is testable without the route tree; the
 * route's `beforeLoad` feeds it the live stores.
 */
export function shouldRedirectThreadToCowork(
  threadId: string,
  sessions: ReadonlyArray<Pick<CoworkSession, 'id' | 'unavailable'>>,
  thread: { metadata?: Record<string, unknown> | null } | null | undefined
): boolean {
  const session = sessions.find((s) => s.id === threadId)
  if (session && session.unavailable !== 'id-collision') return true
  return isCoworkThread(thread)
}
