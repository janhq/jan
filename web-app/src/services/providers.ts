import { models as providerModels } from 'token.js'
import { mockModelProvider } from '@/mock/data'
import { EngineManager, SettingComponentProps } from '@janhq/core'
import { ModelCapabilities } from '@/types/models'
import { modelSettings } from '@/lib/predefined'
import { fetchModels } from './models'
import { ExtensionManager } from '@/lib/extension'

export const getProviders = async (): Promise<ModelProvider[]> => {
  const builtinProviders = mockModelProvider.map((provider) => {
    let models = provider.models as Model[]
    if (Object.keys(providerModels).includes(provider.provider)) {
      const builtInModels = providerModels[
        provider.provider as unknown as keyof typeof providerModels
      ].models as unknown as string[]

      if (Array.isArray(builtInModels))
        models = builtInModels.map((model) => {
          const modelManifest = models.find((e) => e.id === model)
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

  for (const [key, value] of EngineManager.instance().engines) {
    // TODO: Remove this when the cortex extension is removed
    const providerName = key === 'cortex' ? 'llama.cpp' : key

    const models =
      ((await fetchModels()) ?? []).filter(
        (model) =>
          (model.engine === 'llama-cpp' ? 'llama.cpp' : model.engine) ===
            providerName &&
          'status' in model &&
          model.status === 'downloaded'
      ) ?? []
    const provider: ModelProvider = {
      active: false,
      persist: true,
      provider: providerName,
      base_url:
        'inferenceUrl' in value
          ? (value.inferenceUrl as string).replace('/chat/completions', '')
          : '',
      settings: (await value.getSettings()).map((setting) => ({
        key: setting.key,
        title: setting.title,
        description: setting.description,
        controller_type: setting.controllerType as unknown,
        controller_props: setting.controllerProps as unknown,
      })) as ProviderSetting[],
      models: models.map((model) => ({
        id: model.id,
        model: model.id,
        name: model.name,
        description: model.description,
        capabilities:
          'capabilities' in model
            ? (model.capabilities as string[])
            : [ModelCapabilities.COMPLETION],
        provider: providerName,
        settings: Object.values(modelSettings).reduce(
          (acc, setting) => {
            const value = model[
              setting.key as keyof typeof model
            ] as keyof typeof setting.controller_props.value
            acc[setting.key] = {
              ...setting,
              controller_props: {
                ...setting.controller_props,
                value: value ?? setting.controller_props.value,
              },
            }
            return acc
          },
          {} as Record<string, ProviderSetting>
        ),
      })),
    }
    runtimeProviders.push(provider)
  }

  return runtimeProviders.concat(builtinProviders as ModelProvider[])
}

/**
 * Fetches models from a provider's API endpoint
 * @param provider The provider object containing base_url and api_key
 * @returns Promise<string[]> Array of model IDs
 */
export const fetchModelsFromProvider = async (
  provider: ModelProvider
): Promise<string[]> => {
  if (!provider.base_url || !provider.api_key) {
    throw new Error('Provider must have base_url and api_key configured')
  }

  try {
    const response = await fetch(`${provider.base_url}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': provider.api_key,
        'Authorization': `Bearer ${provider.api_key}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`
      )
    }

    const data = await response.json()

    // Handle different response formats that providers might use
    if (data.data && Array.isArray(data.data)) {
      // OpenAI format: { data: [{ id: "model-id" }, ...] }
      return data.data.map((model: { id: string }) => model.id).filter(Boolean)
    } else if (Array.isArray(data)) {
      // Direct array format: ["model-id1", "model-id2", ...]
      return data.filter(Boolean)
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
    throw error
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
  const provider = providerName === 'llama.cpp' ? 'cortex' : providerName
  return ExtensionManager.getInstance()
    .getEngine(provider)
    ?.updateSettings(
      settings.map((setting) => ({
        ...setting,
        controllerProps: {
          ...setting.controller_props,
          value: setting.controller_props.value ?? '',
        },
        controllerType: setting.controller_type,
      })) as SettingComponentProps[]
    )
}
