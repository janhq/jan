import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import type { ModelProvider } from '@/types/modelProviders'
import { mockModelProvider } from '@/mock/data'

type ModelProviderState = {
  providers: ModelProvider[]
  setProviders: (providers: ModelProvider[]) => void
  fetchModelProvider: () => Promise<void>
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProviderApiKey: (providerName: string, apiKey: string) => void
  updateProviderInferenceUrl: (
    providerName: string,
    inferenceUrl: string
  ) => void
  toggleProviderActive: (providerName: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      setProviders: (providers) => set({ providers }),
      toggleProviderActive: (providerName) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            const key = Object.keys(provider)[0]
            if (key === providerName) {
              return {
                [key]: {
                  ...provider[key],
                  active:
                    provider[key].active === null
                      ? true
                      : !provider[key].active,
                },
              }
            }
            return provider
          }),
        }))
      },
      updateProviderApiKey: (providerName, apiKey) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            const key = Object.keys(provider)[0]
            if (key === providerName) {
              return {
                [key]: {
                  ...provider[key],
                  apiKey,
                },
              }
            }
            return provider
          }),
        }))
      },
      updateProviderInferenceUrl: (providerName, inferenceUrl) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            const key = Object.keys(provider)[0]
            if (key === providerName) {
              return {
                [key]: {
                  ...provider[key],
                  inferenceUrl,
                },
              }
            }
            return provider
          }),
        }))
      },
      getProviderByName: (providerName: string) => {
        return get().providers.find((provider) => {
          const key = Object.keys(provider)[0]
          return key === providerName
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
