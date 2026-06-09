import { createContext, useContext, useMemo } from 'react'

import {
  HOME_COMPOSE_CONTEXT_ID,
  projectComposeContextId,
} from '@/constants/chat'
import type { WorkspaceDirectoryScope } from '@/stores/workspace-directory-store'

export const ChatSessionContext = createContext<string | null>(null)

export function useChatSessionId(): string {
  const sessionId = useContext(ChatSessionContext)
  if (!sessionId) {
    return HOME_COMPOSE_CONTEXT_ID
  }
  return sessionId
}

export function sessionWorkspaceScope(
  sessionId: string,
  label: string
): WorkspaceDirectoryScope {
  if (sessionId === HOME_COMPOSE_CONTEXT_ID) {
    return { type: 'workspace', id: 'home', label: 'Home' }
  }
  if (sessionId.startsWith('project-compose:')) {
    return {
      type: 'chat',
      id: sessionId,
      label: label || 'Project chat',
    }
  }
  return {
    type: 'chat',
    id: sessionId,
    label,
  }
}

export function useChatSessionWorkspaceScope(label = 'Chat') {
  const sessionId = useChatSessionId()
  return useMemo(
    () => sessionWorkspaceScope(sessionId, label),
    [sessionId, label]
  )
}

export function resolveComposeSessionId(
  currentThreadId?: string,
  initialMessage?: boolean,
  projectId?: string
): string | null {
  if (currentThreadId && currentThreadId !== 'temporary-chat') {
    return currentThreadId
  }
  if (initialMessage) {
    return projectId
      ? projectComposeContextId(projectId)
      : HOME_COMPOSE_CONTEXT_ID
  }
  return null
}
