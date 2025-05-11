import { models as providerModels } from 'token.js'
import { mockModelProvider } from '@/mock/data'
// import { EngineManager } from '@janhq/core'

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

//   for (const [key, value] of EngineManager.instance().engines) {
//     const provider: ModelProvider = {
//       //       active: boolean
//       //   provider: string
//       //   explore_models_url?: string
//       //   api_key?: string
//       //   base_url?: string
//       //   settings: ProviderSetting[]
//       //   models: Model[]
//       active: false,
//       provider: key,
//       settings: [],
//       models: [],
//     }
//     runtimeProviders.push(provider)
//   }

  return runtimeProviders.concat(builtinProviders as ModelProvider[])
}
