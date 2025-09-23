/**
 * Dynamic Auth Provider Registry
 * Provider-agnostic registry that can be extended at runtime
 */

import { PROVIDERS, type AuthProvider, type ProviderType } from './providers'

export class AuthProviderRegistry {
  private providers = new Map<ProviderType, AuthProvider>()

  constructor() {
    // Register all available providers on initialization
    for (const provider of PROVIDERS) {
      this.providers.set(provider.id, provider)
    }
  }

  getProvider(providerId: ProviderType): AuthProvider | undefined {
    return this.providers.get(providerId)
  }

  getAllProviders(): AuthProvider[] {
    return Array.from(this.providers.values())
  }
}
