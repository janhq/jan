/**
 * Chat-related constants
 */

export const TEMPORARY_CHAT_ID = 'temporary-chat'
export const TEMPORARY_CHAT_QUERY_ID = 'temporary-chat'

/**
 * Single source of truth for the temporary-chat query flag. Parses with
 * URLSearchParams (decoded keys/values, first duplicate wins) and requires the
 * exact value `true`, so substrings like `truex` or `x-temporary-chat=true`
 * never match. Pass the router's `location.searchStr`.
 */
export function isTemporaryChatSearch(search: string | null | undefined): boolean {
  return new URLSearchParams(search ?? '').get(TEMPORARY_CHAT_QUERY_ID) === 'true'
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
