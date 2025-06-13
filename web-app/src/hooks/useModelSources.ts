import { create } from 'zustand'
import { ModelSource } from '@janhq/core'
import {
  addModelSource,
  deleteModelSource,
  fetchModelSources,
} from '@/services/models'

// Service functions for model sources

// Deep comparison function for model sources
const deepCompareModelSources = (
  sources1: ModelSource[],
  sources2: ModelSource[]
): boolean => {
  if (sources1.length !== sources2.length) return false

  return sources1.every((source1, index) => {
    const source2 = sources2[index]
    if (!source2) return false

    // Compare basic properties
    if (source1.id !== source2.id || source1.author !== source2.author) {
      return false
    }

    // Compare metadata
    if (JSON.stringify(source1.metadata) !== JSON.stringify(source2.metadata)) {
      return false
    }

    // Compare models array
    if (source1.models.length !== source2.models.length) return false

    return source1.models.every((model1, modelIndex) => {
      const model2 = source2.models[modelIndex]
      return JSON.stringify(model1) === JSON.stringify(model2)
    })
  })
}

// Zustand store for model sources
type ModelSourcesState = {
  sources: ModelSource[]
  error: Error | null
  loading: boolean
  fetchSources: () => Promise<void>
  addSource: (source: string) => Promise<void>
  deleteSource: (source: string) => Promise<void>
}

export const useModelSources = create<ModelSourcesState>()((set, get) => ({
  sources: [],
  error: null,
  loading: false,

  fetchSources: async () => {
    set({ loading: true, error: null })
    try {
      const newSources = await fetchModelSources()
      const currentSources = get().sources

      if (!deepCompareModelSources(currentSources, newSources)) {
        set({ sources: newSources, loading: false })
      } else {
        set({ loading: false })
      }
    } catch (error) {
      set({ error: error as Error, loading: false })
    }
  },

  addSource: async (source: string) => {
    set({ loading: true, error: null })
    try {
      await addModelSource(source)
      const newSources = await fetchModelSources()
      const currentSources = get().sources

      if (!deepCompareModelSources(currentSources, newSources)) {
        set({ sources: newSources, loading: false })
      } else {
        set({ loading: false })
      }
    } catch (error) {
      set({ error: error as Error, loading: false })
    }
  },

  deleteSource: async (source: string) => {
    set({ loading: true, error: null })
    try {
      await deleteModelSource(source)
      const newSources = await fetchModelSources()
      const currentSources = get().sources

      if (!deepCompareModelSources(currentSources, newSources)) {
        set({ sources: newSources, loading: false })
      } else {
        set({ loading: false })
      }
    } catch (error) {
      set({ error: error as Error, loading: false })
    }
  },
}))

/**
 * @returns Featured model sources from the store
 */
export function useGetFeaturedSources() {
  const { sources } = useModelSources()

  const featuredSources = sources.filter((e) =>
    e.metadata?.tags?.includes('featured')
  )

  return { sources: featuredSources }
}
