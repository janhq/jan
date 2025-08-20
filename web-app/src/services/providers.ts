import { models as providerModels } from 'token.js'
import { predefinedProviders } from '@/consts/providers'
import { EngineManager, SettingComponentProps } from '@janhq/core'
import { ModelCapabilities } from '@/types/models'
import { modelSettings } from '@/lib/predefined'
import { fetchModels, isToolSupported } from './models'
import { ExtensionManager } from '@/lib/extension'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'

export const getProviders = async (): Promise<ModelProvider[]> => {
  const builtinProviders = predefinedProviders.map((provider) => {
    let models = provider.models as Model[]
    if (Object.keys(providerModels).includes(provider.provider)) {
      const builtInModels = providerModels[
        provider.provider as unknown as keyof typeof providerModels
      ].models as unknown as string[]

      if (Array.isArray(builtInModels))
        models = builtInModels.map((model) => {
          const modelManifest = models.find((e) => e.id === model)
          // TODO: Check chat_template for tool call support
          const capabilities = [
            ModelCapabilities.COMPLETION,
            (
              providerModels[
                provider.provider as unknown as keyof typeof providerModels
              ].supportsToolCalls as unknown as string[]
            ).includes(model)
              ? ModelCapabilities.TOOLS
              : undefined,
          ].filter(Boolean) as string[]
          return {
            ...(modelManifest ?? { id: model, name: model }),
            capabilities,
          } as Model
        })
    }

    return {
      ...provider,
      models,
    }
  })

  const runtimeProviders: ModelProvider[] = []
  for (const [providerName, value] of EngineManager.instance().engines) {
    const models = (await fetchModels()) ?? []
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
        models.map(
          async (model) =>
            ({
              id: model.id,
              model: model.id,
              name: model.name,
              description: model.description,
              capabilities:
                'capabilities' in model
                  ? (model.capabilities as string[])
                  : (await isToolSupported(model.id))
                    ? [ModelCapabilities.TOOLS]
                    : [],
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
            }) as Model
        )
      ),
    }
    runtimeProviders.push(provider)
  }

  return runtimeProviders.concat(builtinProviders as ModelProvider[])
}

/**
 * Fetches models from a provider's API endpoint
 * Always uses Tauri's HTTP client to bypass CORS issues
 * @param provider The provider object containing base_url and api_key
 * @returns Promise<string[]> Array of model IDs
 */
export const fetchModelsFromProvider = async (
  provider: ModelProvider
): Promise<string[]> => {
  if (!provider.base_url) {
    throw new Error('Provider must have base_url configured')
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Only add authentication headers if API key is provided
    if (provider.api_key) {
      headers['x-api-key'] = provider.api_key
      headers['Authorization'] = `Bearer ${provider.api_key}`
    }

    // Always use Tauri's fetch to avoid CORS issues
    const response = await fetchTauri(`${provider.base_url}/models`, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      // Provide more specific error messages based on status code
      if (response.status === 401) {
        throw new Error(
          `Authentication failed: API key is required or invalid for ${provider.provider}`
        )
      } else if (response.status === 403) {
        throw new Error(
          `Access forbidden: Check your API key permissions for ${provider.provider}`
        )
      } else if (response.status === 404) {
        throw new Error(
          `Models endpoint not found for ${provider.provider}. Check the base URL configuration.`
        )
      } else {
        throw new Error(
          `Failed to fetch models from ${provider.provider}: ${response.status} ${response.statusText}`
        )
      }
    }

    const data = await response.json()

    // Handle different response formats that providers might use
    if (data.data && Array.isArray(data.data)) {
      // OpenAI format: { data: [{ id: "model-id" }, ...] }
      return data.data.map((model: { id: string }) => model.id).filter(Boolean)
    } else if (Array.isArray(data)) {
      // Direct array format: ["model-id1", "model-id2", ...]
      return data
        .filter(Boolean)
        .map((model) =>
          typeof model === 'object' && 'id' in model ? model.id : model
        )
    } else if (data.models && Array.isArray(data.models)) {
      // Alternative format: { models: [...] }
      return data.models
        .map((model: string | { id: string }) =>
          typeof model === 'string' ? model : model.id
        )
        .filter(Boolean)
    } else {
      console.warn('Unexpected response format from provider API:', data)
      return []
    }
  } catch (error) {
    console.error('Error fetching models from provider:', error)

    if (error instanceof Error && (
      error.message.includes('Authentication failed') ||
      error.message.includes('Access forbidden') ||
      error.message.includes('Models endpoint not found') ||
      error.message.includes('Failed to fetch models from')
    )) {
      throw error
    }

    // Provide helpful error message for network issues
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

/**
 * Update the settings of a provider extension.
 * TODO: Later on we don't retrieve this using provider name
 * @param providerName
 * @param settings
 */
export const updateSettings = async (
  providerName: string,
  settings: ProviderSetting[]
): Promise<void> => {
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
}
