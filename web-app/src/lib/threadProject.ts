import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import { isCoworkThread } from '@/lib/threadMode'

/**
 * Cowork persists from its session, never from the sidebar's thread mirror.
 * Returns whether the assignment was applied, so a caller only reports success
 * for a move that happened.
 */
export function updateThreadProject(
  id: string,
  project: CoworkSession['project']
): boolean {
  const thread = useThreads.getState().threads[id]
  const session = useCoworkSessions.getState().sessions.find((s) => s.id === id)
  if (isCoworkThread(thread) || (!thread && session)) {
    // Missing/unavailable sessions must not acquire a mirror-only assignment
    // that a later persistence pass would silently undo.
    if (!session || session.unavailable) return false
    useCoworkSessions.getState().setProject(id, project)
    const state = useThreads.getState()
    const mirror = state.threads[id]
    if (mirror) {
      state.setThreads(Object.values({
        ...state.threads,
        [id]: { ...mirror, metadata: { ...mirror.metadata, project } },
      }))
    }
    return true
  }
  if (!thread) return false
  useThreads.getState().updateThread(id, {
    metadata: { ...thread.metadata, project },
  })
  return true
}
