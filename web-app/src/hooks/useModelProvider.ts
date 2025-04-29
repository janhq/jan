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
  getProviderByName: (providerName: string) => ProviderObject | undefined
  updateProvider: (providerName: string, data: ProviderObject) => void
  selectModelProvider: (providerName: string, modelName: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llamacpp',
      selectedModel: 'qwen2.5:0.5b',
      setProviders: (providers) => set({ providers }),
      updateProvider: (providerName, data) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            const key = Object.keys(provider)[0]
            if (key === providerName) {
              return {
                [key]: {
                  ...provider[key],
                  ...data,
                },
              }
            }
            return provider
          }),
        }))
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find((provider) => {
          const key = Object.keys(provider)[0]
          return key === providerName
        })

        if (provider) {
          const key = Object.keys(provider)[0]
          // Ensure active is always a boolean, not null
          const providerData = provider[key]
          return {
            ...providerData,
          }
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
        // Use 'unknown' as an intermediate type to avoid direct type errors
        const mockData = await new Promise<unknown>((resolve) =>
          setTimeout(() => resolve(mockModelProvider), 0)
        )

        // Then cast it to the expected type
        const response = mockData as ModelProvider[]

        set({ providers: response })
      },
    }),
    {
      name: localStoregeKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
