import { createFileRoute, redirect } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { ensureCoworkEnabled } from '@/lib/coworkAccess'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

/**
 * `/cowork` has no conversation of its own any more: it forwards to the
 * current session's URL so every existing link (sidebar, artifacts, commands)
 * keeps working. Sessions are hydrated before any route renders, so reading the
 * store here sees them; it only reuses the current session when there is one,
 * and otherwise goes to the start page rather than creating one in a loader.
 */
export const Route = createFileRoute('/cowork/')({
  beforeLoad: () => {
    ensureCoworkEnabled()
    const { currentId, sessions } = useCoworkSessions.getState()
    if (currentId && sessions.some((s) => s.id === currentId)) {
      throw redirect({
        to: route.coworkSession,
        params: { sessionId: currentId },
        replace: true,
      })
    }
    throw redirect({ to: route.home, replace: true })
  },
})
