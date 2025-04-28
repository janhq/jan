import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import type { ModelProvider } from '@/types/modelProviders'
import { mockModelProvider } from '@/mock/data'

type ProviderUpdateData = {
  apiKey?: string
  inferenceUrl?: string
  active?: boolean | null
  // Add other properties that might need updating in the future
}

type ModelProviderState = {
  providers: ModelProvider[]
  setProviders: (providers: ModelProvider[]) => void
  fetchModelProvider: () => Promise<void>
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: ProviderUpdateData) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
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
