import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface LastUsedModelState {
  lastUsedModelId: string | null
  setLastUsedModelId: (modelId: string | null) => void
}

export const useLastUsedModel = create<LastUsedModelState>()(
  persist(
    (set) => ({
      lastUsedModelId: null,
      setLastUsedModelId: (modelId: string | null) =>
        set({ lastUsedModelId: modelId }),
    }),
    {
      name: 'last-used-model-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
