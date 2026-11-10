import { createFileRoute, redirect, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { canOpenCoworkSession } from '@/lib/coworkOpenable'
import { route } from '@/constants/routes'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { CoworkPage } from '@/containers/CoworkPage'
import { ensureCoworkEnabled } from '@/lib/coworkAccess'

export const Route = createFileRoute('/cowork/$sessionId')({
  beforeLoad: ({ params }) => {
    ensureCoworkEnabled()
    const { sessionId } = params as { sessionId: string }
    // Sessions are hydrated before routes render, so an id that is not in the
    // store is unknown, not "not loaded yet".
    if (!canOpenCoworkSession(sessionId)) throw redirect({ to: route.home, replace: true })
    // Select here, not while rendering: a render-phase store write warns on
    // every switch and re-selects a session deleted under the mounted route.
    useCoworkSessions.getState().selectSession(sessionId)
  },
  component: CoworkSessionRoute,
})

function CoworkSessionRoute() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  // The URL is the source of truth: the page and every helper it calls read the
  // current session from the store, so keep the two in lockstep.
  // beforeLoad selects on navigation; this resyncs when only the param changes.
  useEffect(() => {
    if (useCoworkSessions.getState().sessions.some((s) => s.id === sessionId)) {
      useCoworkSessions.getState().selectSession(sessionId)
    }
  }, [sessionId])
  return <CoworkPage />
}
