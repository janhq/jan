import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import { sanitizeModelId } from '@/lib/utils'

// Zustand store for model sources
type ModelSourcesState = {
  sources: CatalogModel[]
  ollamaSources: CatalogModel[]
  hfSources: CatalogModel[]
  error: Error | null
  loading: boolean
  fetchSources: () => Promise<void>
  fetchExternalSources: (hfToken?: string) => Promise<void>
  updateExternalModel: (
    modelName: string,
    patch: Partial<CatalogModel>
  ) => void
}

export const useModelSources = create<ModelSourcesState>()(
  persist(
    (set, get) => ({
      sources: [],
      ollamaSources: [],
      hfSources: [],
      error: null,
      loading: false,
      fetchSources: async () => {
        set({ loading: true, error: null })
        try {
          const newSources = await getServiceHub()
            .models()
            .fetchModelCatalog()
            .then((catalogs) =>
              catalogs
                .map((catalog) => ({
                  ...catalog,
                  quants: catalog.quants?.map((quant) => ({
                    ...quant,
                    model_id: sanitizeModelId(quant.model_id),
                  })),
                  is_mlx: catalog.library_name === 'mlx',
                }))
                .filter((e) => (IS_MACOS ? true : !e.is_mlx))
            )

          set({
            sources: newSources.length ? newSources : get().sources,
            loading: false,
          })
        } catch (error) {
          set({ error: error as Error, loading: false })
        }
      },
      fetchExternalSources: async (hfToken?: string) => {
        const modelsService = getServiceHub().models()
        const [ollamaRes, hfRes] = await Promise.allSettled([
          modelsService.fetchOllamaModels?.() ?? Promise.resolve([]),
          modelsService.fetchHuggingFaceModels?.(undefined, hfToken, 20) ??
            Promise.resolve([]),
        ])

        set({
          ollamaSources:
            ollamaRes.status === 'fulfilled' && ollamaRes.value.length
              ? ollamaRes.value
              : get().ollamaSources,
          hfSources:
            hfRes.status === 'fulfilled' && hfRes.value.length
              ? hfRes.value
              : get().hfSources,
        })
      },
      updateExternalModel: (modelName, patch) => {
        const applyPatch = (list: CatalogModel[]) =>
          list.map((m) => (m.model_name === modelName ? { ...m, ...patch } : m))
        set({
          ollamaSources: applyPatch(get().ollamaSources),
          hfSources: applyPatch(get().hfSources),
        })
      },
    }),
    {
      // Kept in webview localStorage, not the backend settings store: this is a
      // re-fetchable network cache (the full Hub catalog, ~500 KB), not a user
      // setting. Persisting it to settings.json rewrote the whole file on every
      // Hub visit. localStorage is synchronous, so no skipHydration needed.
      name: localStorageKey.modelSources,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sources: state.sources,
      }),
    }
  )
)
