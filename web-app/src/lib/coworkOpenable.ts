import { useCoworkRun } from '@/hooks/useCoworkRun'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

/**
 * Whether `/cowork/$sessionId` shows this session rather than redirecting home.
 * The route guard and the sidebar row share it, so a row can explain a refusal
 * instead of navigating to a redirect that looks like a dead click.
 *
 * An untouched session is not a different start surface: the unified composer
 * stays home unless a run is active.
 */
export function canOpenCoworkSession(sessionId: string): boolean {
  const session = useCoworkSessions
    .getState()
    .sessions.find((s) => s.id === sessionId)
  if (!session) return false
  if (session.unavailable || session.cleared) return true
  return (
    session.turns.length > 0 ||
    session.messages.length > 0 ||
    !!useCoworkRun.getState().runId[sessionId]
  )
}
