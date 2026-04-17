/**
 * Tauri Providers Service - Desktop implementation
 */

import { predefinedProviders } from '@/constants/providers'
import { providerModels } from '@/constants/models'
import { EngineManager, SettingComponentProps } from '@janhq/core'
import { ModelCapabilities } from '@/types/models'
import { modelSettings } from '@/lib/predefined'
import { ExtensionManager } from '@/lib/extension'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { DefaultProvidersService } from './default'
import { getModelCapabilities } from '@/lib/models'
import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'

export class TauriProvidersService extends DefaultProvidersService {
  fetch(): typeof fetch {
    // Tauri implementation uses Tauri's fetch to avoid CORS issues
    return fetchTauri as typeof fetch
  }

  async getProviders(): Promise<ModelProvider[]> {
    try {
      const builtinProviders = predefinedProviders.map((provider) => {
        let models = provider.models as Model[]
        if (Object.keys(providerModels).includes(provider.provider)) {
          const builtInModels = providerModels[
            provider.provider as unknown as keyof typeof providerModels
          ].models as unknown as string[]

          if (Array.isArray(builtInModels)) {
            models = builtInModels.map((model) => {
              const modelManifest = models.find((e) => e.id === model)
              // TODO: Check chat_template for tool call support
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
      }).filter(Boolean)

      // TODO: Re-enable foundation-models once migrated to apple-foundation-models crate
      const hiddenProviders = new Set(['foundation-models'])
      const runtimeProviders: ModelProvider[] = []
      for (const [providerName, value] of EngineManager.instance().engines) {
        if (hiddenProviders.has(providerName)) continue
        const models = await value.list() ?? [] 
        const provider: ModelProvider = {
          active: false,
          persist: true,
          provider: providerName,
          base_url:
            'inferenceUrl' in value
              ? (value.inferenceUrl as string).replace('/chat/completions', '')
              : '',
          settings: (await value.getSettings()).map((setting) => {
            return {
              key: setting.key,
              title: setting.title,
              description: setting.description,
              controller_type: setting.controllerType as unknown,
              controller_props: setting.controllerProps as unknown,
            }
          }) as ProviderSetting[],
          models: await Promise.all(
            models.map(async (model) => {
              let capabilities: string[] = []

              if ('capabilities' in model && Array.isArray(model.capabilities)) {
                capabilities = [...(model.capabilities as string[])]
              }
              if (!capabilities.includes(ModelCapabilities.TOOLS)) {
                try {
                  const toolSupported = await value.isToolSupported(model.id)
                  if (toolSupported) {
                    capabilities.push(ModelCapabilities.TOOLS)
                  }
                } catch (error) {
                  console.warn(
                    `Failed to check tool support for model ${model.id}:`,
                    error
                  )
                  // Continue without tool capabilities if check fails
                }
              }

              // Add embeddings capability for embedding models
              if (model.embedding && !capabilities.includes(ModelCapabilities.EMBEDDINGS)) {
                capabilities = [...capabilities, ModelCapabilities.EMBEDDINGS]
              }

              return {
                id: model.id,
                model: model.id,
                name: model.name,
                displayName: model.name,
                description: model.description,
                capabilities,
                embedding: model.embedding, // Preserve embedding flag for filtering in UI
                provider: providerName,
                settings: Object.values(modelSettings).reduce(
                  (acc, setting) => {
                    let value = setting.controller_props.value
                    if (setting.key === 'ctx_len') {
                      value = 8192 // Default context length for Llama.cpp models
                    }
                    acc[setting.key] = {
                      ...setting,
                      controller_props: {
                        ...setting.controller_props,
                        value: value,
                      },
                    }
                    return acc
                  },
                  {} as Record<string, ProviderSetting>
                ),
              } as Model
            })
          ),
        }
        runtimeProviders.push(provider)
      }

      return runtimeProviders.concat(builtinProviders as ModelProvider[])
    } catch (error: unknown) {
      console.error('Error getting providers in Tauri:', error)
      return []
    }
  }

  async fetchModelsFromProvider(provider: ModelProvider): Promise<string[]> {
    if (!provider.base_url) {
      throw new Error('Provider must have base_url configured')
    }

    try {
      const keyChain = providerRemoteApiKeyChain(provider)
      const keyAttempts: (string | undefined)[] =
        keyChain.length > 0 ? keyChain : [undefined]

      let lastStatus = 0
      let lastStatusText = ''

      for (let ki = 0; ki < keyAttempts.length; ki++) {
        const key = keyAttempts[ki]
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }

        if (
          provider.base_url.includes('localhost:') ||
          provider.base_url.includes('127.0.0.1:')
        ) {
          headers['Origin'] = 'tauri://localhost'
        }

        if (key) {
          headers['x-api-key'] = key
          headers['Authorization'] = `Bearer ${key}`
        }

        if (provider.custom_header) {
          provider.custom_header.forEach((header) => {
            headers[header.header] = header.value
          })
        }

        const response = await fetchTauri(`${provider.base_url}/models`, {
          method: 'GET',
          headers,
        })

        lastStatus = response.status
        lastStatusText = response.statusText

        if (
          [401, 403, 429].includes(response.status) &&
          ki < keyAttempts.length - 1
        ) {
          continue
        }

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              `Authentication failed: API key is required or invalid for ${provider.provider}`
            )
          }
          if (response.status === 403) {
            throw new Error(
              `Access forbidden: Check your API key permissions for ${provider.provider}`
            )
          }
          if (response.status === 404) {
            throw new Error(
              `Models endpoint not found for ${provider.provider}. Check the base URL configuration and make sure it includes the correct version path such as /v1 or /v2.`
            )
          }
          throw new Error(
            `Failed to fetch models from ${provider.provider}: ${response.status} ${response.statusText}`
          )
        }

        const data = await response.json()

        if (data.data && Array.isArray(data.data)) {
          return data.data
            .map((model: { id: string }) => model.id)
            .filter(Boolean)
        }
        if (Array.isArray(data)) {
          return data
            .filter(Boolean)
            .map((model) =>
              typeof model === 'object' && 'id' in model ? model.id : model
            )
        }
        if (data.models && Array.isArray(data.models)) {
          return data.models
            .map((model: string | { id: string }) =>
              typeof model === 'string' ? model : model.id
            )
            .filter(Boolean)
        }
        console.warn('Unexpected response format from provider API:', data)
        throw new Error(
          `Unexpected response format from ${provider.provider}. The provider responded successfully, but Jan could not read a model list from /models.`
        )
      }

      throw new Error(
        `Failed to fetch models from ${provider.provider}: ${lastStatus} ${lastStatusText}`
      )
    } catch (error) {
      console.error('Error fetching models from provider:', error)

      // Preserve structured error messages thrown above
      const structuredErrorPrefixes = [
        'Authentication failed',
        'Access forbidden',
        'Models endpoint not found',
        'Unexpected response format from',
        'Failed to fetch models from',
      ]

      if (
        error instanceof Error &&
        structuredErrorPrefixes.some((prefix) =>
          (error as Error).message.startsWith(prefix)
        )
      ) {
        throw new Error(error.message)
      }

      // Provide helpful error message for any connection errors
      if (error instanceof Error && error.message.includes('fetch')) {
        throw new Error(
          `Cannot connect to ${provider.provider} at ${provider.base_url}. Please check that the service is running and accessible.`
        )
      }

      // Generic fallback
      throw new Error(
        `Unexpected error while fetching models from ${provider.provider}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async updateSettings(
    providerName: string,
    settings: ProviderSetting[]
  ): Promise<void> {
    try {
      return ExtensionManager.getInstance()
        .getEngine(providerName)
        ?.updateSettings(
          settings.map((setting) => ({
            ...setting,
            controllerProps: {
              ...setting.controller_props,
              value:
                setting.controller_props.value !== undefined
                  ? setting.controller_props.value
                  : '',
            },
            controllerType: setting.controller_type,
          })) as SettingComponentProps[]
        )
    } catch (error) {
      console.error('Error updating settings in Tauri:', error)
      throw error
    }
  }
}
