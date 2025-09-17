/**
 * Provider Type Definitions
 * Interfaces and types for authentication providers
 */

import { AuthTokens } from '../types'

export { AuthTokens } from '../types'
// Login URL response from API
export interface LoginUrlResponse {
  object: string
  url: string
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
