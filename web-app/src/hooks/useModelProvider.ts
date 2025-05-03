import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

import { mockModelProvider } from '@/mock/data'

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: string
  setProviders: (providers: ModelProvider[]) => void
  fetchModelProvider: () => Promise<void>
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (providerName: string, modelName: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llama.cpp',
      selectedModel: 'llama3.2:3b',
      setProviders: (providers) => set({ providers }),
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

        if (provider) {
          return provider
        }

        return undefined
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        set({
          selectedProvider: providerName,
          selectedModel: modelName,
        })
      },
      fetchModelProvider: async () => {
        // Check if we already have providers in the store
        const currentProviders = get().providers

        // Always fetch mock data to check for updates
        const mockData = await new Promise<unknown>((resolve) =>
          setTimeout(() => resolve(mockModelProvider), 0)
        )

        // Then cast it to the expected type
        const response = mockData as ModelProvider[]

        // If providers array is empty, simply set it with the mock data
        if (currentProviders.length === 0) {
          set({ providers: response })
          return
        }

        // Check if there are new providers or updates to existing providers
        const updatedProviders = [...currentProviders]
        let hasChanges = false

        // Check for new providers or updates to existing ones
        response.forEach((mockProvider) => {
          const existingProviderIndex = updatedProviders.findIndex(
            (provider) => provider.provider === mockProvider.provider
          )

          if (existingProviderIndex === -1) {
            // This is a new provider, add it
            console.log(`Adding new provider: ${mockProvider.provider}`)
            updatedProviders.push(mockProvider)
            hasChanges = true
          } else {
            const existingProvider = updatedProviders[existingProviderIndex]

            // Preserve user-modified settings
            const userSettings = existingProvider.settings || []
            const mockSettings = mockProvider.settings || []

            // Create a map of user settings by key for easy lookup
            const userSettingsMap = new Map()
            userSettings.forEach((setting) => {
              if (
                setting.key &&
                setting.controller_props &&
                setting.controller_props.value !== undefined
              ) {
                userSettingsMap.set(setting.key, setting.controller_props.value)
              }
            })

            // Apply user settings to mock settings
            const mergedSettings = mockSettings.map((mockSetting) => {
              if (mockSetting.key && userSettingsMap.has(mockSetting.key)) {
                return {
                  ...mockSetting,
                  controller_props: {
                    ...mockSetting.controller_props,
                    value: userSettingsMap.get(mockSetting.key),
                  },
                }
              }
              return mockSetting
            })

            // Check if there are new models in this provider
            const updatedProvider = { ...mockProvider }
            let needsUpdate = false

            if (mockProvider.models && existingProvider.models) {
              // Create a map of existing models by ID for easy lookup
              const existingModelsMap = new Map()
              existingProvider.models.forEach((model) => {
                existingModelsMap.set(model.id, model)
              })

              // Preserve user-modified model capabilities and settings
              updatedProvider.models = mockProvider.models.map((mockModel) => {
                const existingModel = existingModelsMap.get(mockModel.id)
                if (existingModel) {
                  // Create a merged model that preserves user modifications
                  const mergedModel = { ...mockModel }

                  // Preserve capabilities if they exist
                  if (existingModel.capabilities) {
                    mergedModel.capabilities = existingModel.capabilities
                  }

                  // Preserve settings if they exist
                  if (existingModel.settings) {
                    mergedModel.settings = existingModel.settings
                  }

                  return mergedModel
                }
                return mockModel
              })

              // Check for new models
              const existingModelIds = existingProvider.models.map(
                (model) => model.id
              )
              const hasNewModels = mockProvider.models.some(
                (model) => !existingModelIds.includes(model.id)
              )

              if (hasNewModels) {
                console.log(
                  `Found new models in provider: ${mockProvider.provider}`
                )
                needsUpdate = true
              }
            }

            // Preserve user-modified api_key, base_url, and active state
            if (existingProvider.api_key) {
              updatedProvider.api_key = existingProvider.api_key
            }

            if (existingProvider.base_url) {
              updatedProvider.base_url = existingProvider.base_url
            }

            // Preserve the active state
            if (existingProvider.active !== undefined) {
              updatedProvider.active = existingProvider.active
            }

            // Apply merged settings
            updatedProvider.settings = mergedSettings

            // Check if there are other structural changes (new fields, etc.)
            const existingProviderWithoutSettings = {
              ...existingProvider,
              settings: [],
            }
            const mockProviderWithoutSettings = {
              ...mockProvider,
              settings: [],
            }

            const existingJSON = JSON.stringify(existingProviderWithoutSettings)
            const mockJSON = JSON.stringify(mockProviderWithoutSettings)

            if (existingJSON !== mockJSON) {
              console.log(
                `Found structural changes in provider: ${mockProvider.provider}`
              )
              needsUpdate = true
            }

            if (needsUpdate) {
              updatedProviders[existingProviderIndex] = updatedProvider
              hasChanges = true
            }
          }
        })

        // Update the store if there were changes
        if (hasChanges) {
          set({ providers: updatedProviders })
        }
      },
    }),
    {
      name: localStoregeKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
