/**
 * Authentication Constants and Configuration
 * Generic constants used across all auth providers
 */

// Storage keys
export const AUTH_STORAGE_KEYS = {
  AUTH_PROVIDER: 'jan_auth_provider',
} as const

// Generic API endpoints (provider-agnostic)
export const AUTH_ENDPOINTS = {
  ME: '/auth/me',
  LOGOUT: '/auth/logout',
  GUEST_LOGIN: '/auth/guest-login',
  REFRESH_TOKEN: '/auth/refresh-token',
} as const

// Token expiry buffer
export const TOKEN_EXPIRY_BUFFER = 60 * 1000 // 1 minute buffer before expiry

// Broadcast channel name for cross-tab communication (BroadcastChannel API)
// Used to sync auth state between different browser tabs
export const AUTH_BROADCAST_CHANNEL = 'jan_auth_channel'

// Custom event name for same-tab communication (window.dispatchEvent)
// Used to notify components within the same tab about auth state changes
export const AUTH_EVENT_NAME = 'jan-auth-event'

// Auth events
export const AUTH_EVENTS = {
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
} as const
