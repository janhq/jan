import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import { isCoworkThread } from '@/lib/threadMode'

/** Cowork persists from its session, never from the sidebar's thread mirror. */
export function updateThreadProject(
  id: string,
  project: CoworkSession['project']
): void {
  const thread = useThreads.getState().threads[id]
  const session = useCoworkSessions.getState().sessions.find((s) => s.id === id)
  if (isCoworkThread(thread) || (!thread && session)) {
    // Missing/unavailable sessions must not acquire a mirror-only assignment
    // that a later persistence pass would silently undo.
    if (!session || session.unavailable) return
    useCoworkSessions.getState().setProject(id, project)
    const state = useThreads.getState()
    const mirror = state.threads[id]
    if (mirror) {
      state.setThreads(Object.values({
        ...state.threads,
        [id]: { ...mirror, metadata: { ...mirror.metadata, project } },
      }))
    }
    return
  }
  if (thread) {
    useThreads.getState().updateThread(id, {
      metadata: { ...thread.metadata, project },
    })
  }
}
