import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  setProviders: (providers: ModelProvider[]) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  deleteModel: (modelId: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llama.cpp',
      selectedModel: null,
      setProviders: (providers) =>
        set((state) => {
          const existingProviders = state.providers
          const updatedProviders = providers.map((provider) => {
            const existingProvider = existingProviders.find(
              (x) => x.provider === provider.provider
            )
            const models = existingProvider?.models || []
            const mergedModels = [
              ...(provider?.models ?? []),
              ...models.filter(
                (e) => !provider?.models.some((m) => m.id === e.id)
              ),
            ]
            return {
              ...provider,
              models: mergedModels,
              settings: provider.settings.map((setting) => {
                const existingSetting = existingProvider?.settings?.find(
                  (x) => x.key === setting.key
                )
                return {
                  ...setting,
                  controller_props: {
                    ...setting.controller_props,
                    ...(existingSetting?.controller_props || {}),
                  },
                }
              }),
              api_key: existingProvider?.api_key || provider.api_key,
              base_url: existingProvider?.base_url || provider.base_url,
              active: existingProvider?.active || true,
            }
          })

          return {
            providers: updatedProviders,
          }
        }),
      updateProvider: (providerName, data) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            if (provider.provider === providerName) {
              return {
                ...provider,
                ...data,
              }
            }
            return provider
          }),
        }))
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Update state with provider name and model object
        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            const models = provider.models.filter(
              (model) => model.id !== modelId
            )
            return {
              ...provider,
              models,
            }
          }),
        }))
      },
    }),
    {
      name: localStoregeKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
