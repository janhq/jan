/**
 * Chat session and status constants
 */

// Session IDs
export const PRIVATE_CHAT_SESSION_ID = 'private-chat'
export const TEMPORARY_CHAT_SESSION_ID = 'temporary-chat'

// Chat Status (matches ChatStatus type from 'ai' SDK)
export const CHAT_STATUS = {
  SUBMITTED: 'submitted',
  STREAMING: 'streaming',
  READY: 'ready',
  ERROR: 'error',
} as const

export type ChatStatusValue = (typeof CHAT_STATUS)[keyof typeof CHAT_STATUS]

// Branch names
export const BRANCH = {
  MAIN: 'MAIN',
} as const
