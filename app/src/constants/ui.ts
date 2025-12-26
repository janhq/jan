/**
 * UI-related constants: theme, URL params, settings, animations
 */

// Theme values
export const THEME = {
  DARK: 'dark',
  LIGHT: 'light',
  SYSTEM: 'system',
} as const

export type ThemeValue = (typeof THEME)[keyof typeof THEME]

// Media query for dark mode detection
export const MEDIA_QUERY = {
  PREFERS_DARK: '(prefers-color-scheme: dark)',
} as const

// URL search parameters
export const URL_PARAM = {
  MODAL: 'modal',
  SETTING: 'setting',
  PROJECTS: 'projects',
  SEARCH: 'search',
} as const

// URL param values
export const URL_PARAM_VALUE = {
  LOGIN: 'login',
  CREATE: 'create',
  OPEN: 'open',
} as const

// Settings dialog sections
export const SETTINGS_SECTION = {
  GENERAL: 'general',
  PERSONALIZATION: 'personalization',
  SHARES: 'shares',
  PRIVACY: 'privacy',
} as const

export type SettingsSectionValue =
  (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION]

// Browser/WebSocket connection states
export const CONNECTION_STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
} as const

export type ConnectionStateValue =
  (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE]

// Upload status
export const UPLOAD_STATUS = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type UploadStatusValue =
  (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS]

// Scroll animation config (spring physics)
export const SCROLL_ANIMATION = {
  MASS: 1.35, // inertia, higher = slower (default: 1.25)
  DAMPING: 0.72, // 0-1, higher = less bouncy (default: 0.7)
  STIFFNESS: 0.045, // acceleration, lower = gentler (default: 0.05)
} as const

// Pagination / Query limits
export const QUERY_LIMIT = {
  ITEMS: 100,
  MAX_RECENT_SEARCHES: 5,
} as const

export const QUERY_ORDER = {
  ASC: 'asc',
  DESC: 'desc',
} as const
