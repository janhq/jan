import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  deletedModels: string[]
  getModelBy: (modelId: string) => Model | undefined
  setProviders: (providers: ModelProvider[]) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  addProvider: (provider: ModelProvider) => void
  deleteProvider: (providerName: string) => void
  deleteModel: (modelId: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      deletedModels: [],
      getModelBy: (modelId: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === modelId)
      },
      setProviders: (providers) =>
        set((state) => {
          const existingProviders = state.providers
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          const updatedProviders = providers.map((provider) => {
            const existingProvider = existingProviders.find(
              (x) => x.provider === provider.provider
            )
            const models = existingProvider?.models || []
            const mergedModels = [
              ...models,
              ...(provider?.models ?? []).filter(
                (e) =>
                  !models.some((m) => m.id === e.id) &&
                  !currentDeletedModels.includes(e.id)
              ),
            ]
            return {
              ...provider,
              models: mergedModels,
              settings: provider.settings.map((setting) => {
                const existingSetting = provider.persist
                  ? undefined
                  : existingProvider?.settings?.find(
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
              active: existingProvider ? existingProvider?.active : true,
            }
          })
          return {
            providers: [
              ...updatedProviders,
              ...existingProviders.filter(
                (e) => !updatedProviders.some((p) => p.provider === e.provider)
              ),
            ],
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
        set((state) => {
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          return {
            providers: state.providers.map((provider) => {
              const models = provider.models.filter(
                (model) => model.id !== modelId
              )
              return {
                ...provider,
                models,
              }
            }),
            deletedModels: [...currentDeletedModels, modelId],
          }
        })
      },
      addProvider: (provider: ModelProvider) => {
        set((state) => ({
          providers: [...state.providers, provider],
        }))
      },
      deleteProvider: (providerName: string) => {
        set((state) => ({
          providers: state.providers.filter(
            (provider) => provider.provider !== providerName
          ),
        }))
      },
    }),
    {
      name: localStorageKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
