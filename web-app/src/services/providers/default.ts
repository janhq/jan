/**
 * Default Providers Service - Web implementation
 */

import { models as providerModels } from 'token.js'
import { predefinedProviders } from '@/constants/providers'
import { getModelCapabilities } from '@/lib/models'
import type { ProvidersService } from './types'

export class DefaultProvidersService implements ProvidersService {
  async getProviders(): Promise<ModelProvider[]> {
    // Return predefined providers for web mode (user API keys are stored in zustand/localStorage)
    const builtinProviders = predefinedProviders.map((provider) => {
      let models = provider.models as Model[]
      if (Object.keys(providerModels).includes(provider.provider)) {
        const builtInModels = providerModels[
          provider.provider as unknown as keyof typeof providerModels
        ].models as unknown as string[]

        if (Array.isArray(builtInModels)) {
          models = builtInModels.map((model) => {
            const modelManifest = models.find((e) => e.id === model)
            return {
              ...(modelManifest ?? { id: model, name: model }),
              capabilities: getModelCapabilities(provider.provider, model),
            } as Model
          })
        }
      }

      return {
        ...provider,
        models,
      }
    })

    return builtinProviders
  }

  async fetchModelsFromProvider(provider: ModelProvider): Promise<string[]> {
    if (!provider.base_url) return []

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (provider.api_key) {
        headers['Authorization'] = `Bearer ${provider.api_key}`
      }
      if (provider.custom_header) {
        for (const h of provider.custom_header) {
          if (h.header && h.value) {
            headers[h.header] = h.value
          }
        }
      }

      const response = await fetch(`${provider.base_url}/models`, { headers })
      if (!response.ok) return []

      const data = await response.json()
      const models: string[] = (data.data ?? []).map(
        (m: { id: string }) => m.id
      )
      return models
    } catch (error) {
      console.warn('Failed to fetch models from provider:', error)
      return []
    }
  }

  async updateSettings(_providerName: string, _settings: ProviderSetting[]): Promise<void> {
    // No-op - settings are managed via zustand/localStorage in web mode
  }

  fetch(): typeof fetch {
    return fetch
  }
}
