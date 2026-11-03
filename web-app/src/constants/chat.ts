/**
 * Chat-related constants
 */

export const TEMPORARY_CHAT_ID = 'temporary-chat'
export const TEMPORARY_CHAT_QUERY_ID = 'temporary-chat'

/**
 * Single source of truth for the temporary-chat query flag. Parses with
 * URLSearchParams (decoded keys/values) and requires the exact value `true`,
 * so substrings like `truex` or `x-temporary-chat=true` never match.
 *
 * Duplicates: on a RAW query string the parser is first-wins
 * (`?temporary-chat=true&temporary-chat=false` -> true). The actual router
 * does not hand consumers a raw string. Its default parse/stringify folds
 * duplicate keys into a JSON array and re-encodes it, so `location.searchStr`
 * is `?temporary-chat=%5Btrue%2Cfalse%5D`, which decodes to `[true,false]`
 * (not `true`) and is therefore false for ANY duplicate, in any order. Pass
 * the router's `location.searchStr`; consumer behavior is unchanged.
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
