/**
 * Chat-related constants
 */

export const TEMPORARY_CHAT_ID = 'temporary-chat'
export const TEMPORARY_CHAT_QUERY_ID = 'temporary-chat'

/** Workspace context key for the home compose screen (no thread yet). */
export const HOME_COMPOSE_CONTEXT_ID = 'home'

export function projectComposeContextId(projectId: string) {
  return `project-compose:${projectId}`
}

/**
 * Session storage keys for initial messages
 */
export const SESSION_STORAGE_KEY = {
  INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
} as const

export const SESSION_STORAGE_PREFIX = {
  INITIAL_MESSAGE: 'initial-message-',
} as const
