import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { createJSONStorage, persist } from 'zustand/middleware'
import { fetchModelCatalog, CatalogModel } from '@/services/models'

// Zustand store for model sources
type ModelSourcesState = {
  sources: CatalogModel[]
  error: Error | null
  loading: boolean
  fetchSources: () => Promise<void>
}

export const useModelSources = create<ModelSourcesState>()(
  persist(
    (set, get) => ({
      sources: [],
      error: null,
      loading: false,
      fetchSources: async () => {
        set({ loading: true, error: null })
        try {
          const newSources = await fetchModelCatalog()

          set({
            sources: newSources.length ? newSources : get().sources,
            loading: false,
          })
        } catch (error) {
          set({ error: error as Error, loading: false })
        }
      },
    }),
    {
      name: localStorageKey.modelSources,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
