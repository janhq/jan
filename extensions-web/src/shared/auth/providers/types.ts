/**
 * Provider Type Definitions
 * Interfaces and types for authentication providers
 */

import { AuthTokens } from '../types'

export { AuthTokens } from '../types'
// Login URL response from API
// Supports multiple formats for different OAuth providers
export interface LoginUrlResponse {
  // Standard format (used by most providers)
  object?: string
  url?: string
  
  // Keycloak format
  authorization_url?: string
  state?: string
}

// Provider interface - all providers must implement this
export interface AuthProvider {
  readonly id: string
  readonly name: string
  readonly icon: string

  // Provider-specific configuration
  getLoginEndpoint(): string
  getCallbackEndpoint(): string

  // OAuth flow methods
  initiateLogin(): Promise<void>
  handleCallback(code: string, state?: string): Promise<AuthTokens>
}
