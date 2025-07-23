import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { createJSONStorage, persist } from 'zustand/middleware'
import { fetchModelCatalog, CatalogModel } from '@/services/models'

// Zustand store for model sources
type ModelSourcesState = {
  sources: CatalogModel[]
  error: Error | null
  loading: boolean
  addSource: (source: CatalogModel) => void
  fetchSources: () => Promise<void>
}

export const useModelSources = create<ModelSourcesState>()(
  persist(
    (set, get) => ({
      sources: [],
      error: null,
      loading: false,

      addSource: (source: CatalogModel) => {
        set((state) => ({
          sources: [
            ...state.sources.filter((e) => e.model_name !== source.model_name),
            source,
          ],
        }))
      },
      fetchSources: async () => {
        set({ loading: true, error: null })
        try {
          const newSources = await fetchModelCatalog()
          const currentSources = get().sources

          set({
            sources: [
              ...newSources,
              ...currentSources.filter(
                (e) => !newSources.some((s) => s.model_name === e.model_name)
              ),
            ],
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
