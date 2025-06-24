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
  addSource: (source: string) => Promise<void>
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

      addSource: async (source: string) => {
        set({ loading: true, error: null })
        console.log(source)
        // try {
        //   await addModelSource(source)
        //   const newSources = await fetchModelSources()
        //   const currentSources = get().sources

        //   if (!deepCompareModelSources(currentSources, newSources)) {
        //     set({ sources: newSources, loading: false })
        //   } else {
        //     set({ loading: false })
        //   }
        // } catch (error) {
        //   set({ error: error as Error, loading: false })
        // }
      },
    }),
    {
      name: localStorageKey.modelSources,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
