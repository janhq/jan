/**
 * Auth Providers Export
 * Central place to register and export all available providers
 */

export { BaseAuthProvider } from './base'
export { KeycloakAuthProvider } from './keycloak'

// Registry of all available providers
import { KeycloakAuthProvider } from './keycloak'

// Instantiate providers
export const PROVIDERS = [new KeycloakAuthProvider()] as const

// Generate proper types from providers
export type ProviderType = (typeof PROVIDERS)[number]['id']

// Export types
export type { AuthProvider } from './types'
