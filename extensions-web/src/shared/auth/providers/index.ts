/**
 * Auth Providers Export
 * Central place to register and export all available providers
 */

export { BaseAuthProvider } from './base'
export { GoogleAuthProvider } from './google'

// Registry of all available providers
import { GoogleAuthProvider } from './google'

// Instantiate providers
export const PROVIDERS = [new GoogleAuthProvider()] as const

// Generate proper types from providers
export type ProviderType = (typeof PROVIDERS)[number]['id']

// Export types
export type { AuthProvider } from './types'
