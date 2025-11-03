/**
 * Generic Authentication Types
 * Provider-agnostic type definitions
 */

import type { ProviderType } from './providers'
import { AUTH_EVENTS } from './const'

export enum AuthState {
  GUEST = 'guest',
  AUTHENTICATED = 'authenticated',
  UNAUTHENTICATED = 'unauthenticated',
}

export type AuthType = ProviderType | 'guest'

export interface AuthTokens {
  access_token: string
  expires_in?: number
  expires_at?: string
  object: string
}

export interface User {
  id: string
  email: string
  name: string
  object: string
  picture?: string
}

export type AuthBroadcastMessage = typeof AUTH_EVENTS[keyof typeof AUTH_EVENTS]
