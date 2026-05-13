import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

interface DefaultEmbeddingModelState {
  defaultByProvider: Record<string, string>
  setDefault: (provider: string, modelId: string) => void
  clearDefault: (provider: string) => void
  getDefault: (provider: string) => string | undefined
}

export const useDefaultEmbeddingModel = create<DefaultEmbeddingModelState>()(
  persist(
    (set, get) => ({
      defaultByProvider: {},
      setDefault: (provider, modelId) =>
        set((state) => ({
          defaultByProvider: {
            ...state.defaultByProvider,
            [provider]: modelId,
          },
        })),
      clearDefault: (provider) =>
        set((state) => {
          const next = { ...state.defaultByProvider }
          delete next[provider]
          return { defaultByProvider: next }
        }),
      getDefault: (provider) => get().defaultByProvider[provider],
    }),
    {
      name: localStorageKey.defaultEmbeddingModel,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
