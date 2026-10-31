import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { writeCoworkHandoff, type CoworkHandoff } from '@/lib/coworkHandoff'

type StartCoworkConversation = {
  model: CoworkSession['model']
  folder: CoworkSession['folder']
  project: CoworkSession['project']
  handoff: CoworkHandoff
}

/** A submitted NEW conversation must never reuse an empty, refused session.
 * Persist the handoff before callers navigate or clear their composer. On
 * failure restore the selection and throw so the composer can reject submit.
 */
export function startCoworkConversation({
  model,
  folder,
  project,
  handoff,
}: StartCoworkConversation): string {
  const previousId = useCoworkSessions.getState().currentId
  useCoworkSessions.setState({ currentId: null })
  const id = useCoworkSessions.getState().createSession()
  try {
    useCoworkSessions.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, model, folder, project } : session
      ),
    }))
    writeCoworkHandoff(id, handoff)
  } catch (error) {
    useCoworkSessions.setState((s) => ({
      sessions: s.sessions.filter((session) => session.id !== id),
      currentId: previousId,
    }))
    throw error
  }
  return id
}
