import { useChatPermissions } from '@/hooks/useChatPermissions'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { getServiceHub } from '@/hooks/useServiceHub'
import { ensureCoworkRecorded } from '@/lib/coworkSync'
import {
  isConversationFolderPath,
  type ConversationCapabilitiesV1,
} from '@/lib/conversationCapabilities'

export type CoworkFolderAccess = 'read' | 'write'

type FolderSession = { folder: string | null; folderAccess?: CoworkFolderAccess | null }

/**
 * The attached folder and the access the host has acknowledged for it.
 *
 * `folderAccess` is only ever written from a host-accepted grant or from what
 * the host stored, so this never widens it. Absent (a legacy session with no
 * host record) is inactive: the host refuses legacy no-record folder calls, so
 * it must not be displayed or used as write. A folder whose
 * access is `null` or absent is shown but not handed to tools at all: the host treats a
 * caller folder it does not authorize as an error, not as read-only.
 */
export function coworkFolderGrant(
  session: FolderSession | null | undefined
): { folder: string | null; access: CoworkFolderAccess | null } {
  if (!session?.folder) return { folder: null, access: null }
  const access = session.folderAccess ?? null
  return access ? { folder: session.folder, access } : { folder: null, access: null }
}

/** Live read for tool dispatch, so a mid-run change never uses a stale snapshot. */
export function liveCoworkFolderGrant(sessionId: string) {
  return coworkFolderGrant(
    useCoworkSessions.getState().sessions.find((s) => s.id === sessionId)
  )
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Persist a folder grant for a Cowork session through the host's strict setter,
 * and only then record it locally. The setter narrows the host before it
 * writes, so a failure leaves the host denied: the UI then keeps the folder
 * visible with no access instead of claiming the old one. Requests for one
 * session run in order.
 */
export function setCoworkFolderGrant(
  sessionId: string,
  folderScope: { path: string; access: CoworkFolderAccess } | null
): Promise<void> {
  if (folderScope && !isConversationFolderPath(folderScope.path)) {
    return Promise.reject(new Error('Unsupported folder path'))
  }
  const run = async () => {
    try {
      // The setter never creates a thread; the record must exist first.
      await ensureCoworkRecorded(sessionId)
      const { shellNetwork, memoryWrite } = useChatPermissions.getState()
      const value: ConversationCapabilitiesV1 = {
        version: 1,
        folderScope,
        shellNetwork,
        memoryWrite,
      }
      await getServiceHub().threads().setConversationCapabilities(sessionId, value)
    } catch (error) {
      const current = useCoworkSessions
        .getState()
        .sessions.find((s) => s.id === sessionId)
      if (current?.folder) {
        useCoworkSessions
          .getState()
          .setFolderGrant(sessionId, { path: current.folder, access: null })
      }
      throw error
    }
    useCoworkSessions.getState().setFolderGrant(sessionId, folderScope)
  }
  const next = (queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(run)
  queues.set(sessionId, next)
  const clear = () => {
    if (queues.get(sessionId) === next) queues.delete(sessionId)
  }
  next.then(clear, clear)
  return next
}
