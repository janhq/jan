import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { abortRun } from '@/lib/coworkRunner'
import { dropMonitorLane } from '@/lib/coworkMonitor'
import { cancelAgentThreadBash, stopAgentSessionMonitors } from '@/lib/agentTools'

/**
 * Whether a Cowork session with this id is live in the session store. While it
 * is, the store (via `coworkSync`) owns the thread's persistence and deletion.
 */
export const hasCoworkSession = (id: string): boolean =>
  useCoworkSessions.getState().sessions.some((s) => s.id === id)

/**
 * Delete a Cowork conversation from anywhere (the shared thread list, a bulk
 * delete). A running turn and its watchers die with it, and the removal goes
 * through the session store so `coworkSync` journals it, deletes the thread and
 * reclaims the sandbox. Deleting the thread record behind the store's back would
 * leave a live session that fails its next write.
 */
export function deleteCoworkConversation(id: string): void {
  abortRun(id)
  void cancelAgentThreadBash(id)
  void stopAgentSessionMonitors(id)
  dropMonitorLane(id)
  useCoworkRun.getState().clearMonitors(id)
  useCoworkSessions.getState().deleteSession(id)
}
