/**
 * Chat-related constants
 */

export const TEMPORARY_CHAT_ID = 'temporary-chat'
export const TEMPORARY_CHAT_QUERY_ID = 'temporary-chat'

/**
 * Single source of truth for the temporary-chat query flag. Parses with
 * URLSearchParams (decoded keys/values). It fails PRIVACY-CLOSED: the chat is
 * temporary when ANY `temporary-chat` value is exactly `true`, regardless of
 * duplicate order (`?temporary-chat=false&temporary-chat=true` -> true).
 * Substrings like `truex` or `x-temporary-chat=true` never match.
 *
 * The actual router does not hand consumers a raw string. Its default
 * parse/stringify folds duplicate keys into a JSON array and re-encodes it, so
 * `location.searchStr` is `?temporary-chat=%5Btrue%2Cfalse%5D`, which decodes
 * to the text `[true,false]`. A value that parses as a JSON array containing
 * boolean `true` or string `"true"` is therefore also temporary; arrays with
 * only other elements (e.g. `[false,false]`) are not.
 */
export function isTemporaryChatSearch(search: string | null | undefined): boolean {
  return new URLSearchParams(search ?? '')
    .getAll(TEMPORARY_CHAT_QUERY_ID)
    .some(isTemporaryChatValue)
}

function isTemporaryChatValue(value: string): boolean {
  if (value === 'true') return true
  if (!value.startsWith('[')) return false
  try {
    const parsed: unknown = JSON.parse(value)
    return (
      Array.isArray(parsed) &&
      parsed.some((item) => item === true || item === 'true')
    )
  } catch {
    return false
  }
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
