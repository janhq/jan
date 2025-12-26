/**
 * localStorage and sessionStorage keys
 */

// localStorage keys
export const LOCAL_STORAGE_KEY = {
  PRIVATE_CHAT: 'private-chat-storage',
  THEME: 'theme',
  RECENT_SEARCHES: 'recent-searches',
  // OAuth keys
  OAUTH_STATE: 'oauth_state',
  OAUTH_CODE_VERIFIER: 'oauth_code_verifier',
  OAUTH_REDIRECT_URL: 'oauth_redirect_url',
} as const

// sessionStorage keys
export const SESSION_STORAGE_KEY = {
  INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
} as const

// sessionStorage key prefixes (for dynamic keys with IDs)
export const SESSION_STORAGE_PREFIX = {
  INITIAL_MESSAGE: 'initial-message-',
  INITIAL_ITEMS: 'initial-items-',
} as const
