import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import { sanitizeModelId } from '@/lib/utils'

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
          const newSources = await getServiceHub().models().fetchModelCatalog().then((catalogs) =>
            catalogs.map((catalog) => ({
              ...catalog,
              quants: catalog.quants.map((quant) => ({
                ...quant,
                model_id: sanitizeModelId(quant.model_id),
              })),
            }))
          )

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
