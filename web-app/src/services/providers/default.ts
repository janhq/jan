/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Providers Service - Generic implementation with minimal returns
 */

import type { ProvidersService } from './types'

export class DefaultProvidersService implements ProvidersService {
  async getProviders(): Promise<ModelProvider[]> {
    return []
  }

  async fetchModelsFromProvider(provider: ModelProvider): Promise<string[]> {
    return []
  }

  async updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void> {
    // No-op
  }

  fetch(): typeof fetch {
    return fetch
  }
}