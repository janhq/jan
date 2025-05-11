import { models as providerModels } from 'token.js'
import { mockModelProvider } from '@/mock/data'
import { EngineManager, InferenceEngine, ModelManager } from '@janhq/core'

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
            'completion',
            (
              providerModels[
                provider.provider as unknown as keyof typeof providerModels
              ].supportsToolCalls as unknown as string[]
            ).includes(model)
              ? 'tools'
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
    const providerName = key === InferenceEngine.cortex ? 'llama.cpp' : key
    const models =
      Array.from(ModelManager.instance().models.values()).filter(
        (model) =>
          (model.engine === 'llama-cpp' ? 'llama.cpp' : model.engine) ===
            providerName &&
          'status' in model &&
          model.status === 'downloaded'
      ) ?? []
    const provider: ModelProvider = {
      active: false,
      provider: providerName,
      settings: (await value.getSettings()).map((setting) => ({
        key: setting.key,
        title: setting.title,
        description: setting.description,
        controller_type: setting.controllerType as unknown,
        controller_props: setting.controllerProps as unknown,
      })) as ProviderSetting[],
      models: models.map((model: Model) => ({
        id: model.id,
        model: model.id,
        name: model.name,
        description: model.description,
        capabilities:
          'capabilities' in model ? model.capabilities : ['completion'],
        provider: providerName,
      })),
    }
    runtimeProviders.push(provider)
  }

  return runtimeProviders.concat(builtinProviders as ModelProvider[])
}
