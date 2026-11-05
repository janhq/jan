import { createFileRoute, redirect, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { peekCoworkHandoff } from '@/lib/coworkHandoff'
import { route } from '@/constants/routes'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { CoworkPage } from '@/containers/CoworkPage'

export const Route = createFileRoute('/cowork/$sessionId')({
  beforeLoad: ({ params }) => {
    const { sessionId } = params as { sessionId: string }
    // Sessions are hydrated before routes render, so an id that is not in the
    // store is unknown, not "not loaded yet".
    const session = useCoworkSessions.getState().sessions.find((s) => s.id === sessionId)
    if (!session) throw redirect({ to: route.home, replace: true })
    // An untouched session is not a different start surface. Keep the unified
    // composer unless its first prompt is being handed off or a run is active.
    if (!session.unavailable && !session.cleared && !session.turns.length && !session.messages.length &&
        !useCoworkRun.getState().runId[sessionId] && !peekCoworkHandoff(sessionId)) {
      throw redirect({ to: route.home, replace: true })
    }
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
