import { create } from 'zustand'
import { ModelSource } from '@janhq/core'
import {
  addModelSource,
  deleteModelSource,
  fetchModelSources,
} from '@/services/models'

// Service functions for model sources

// Zustand store for model sources
type ModelSourcesState = {
  sources: ModelSource[]
  error: Error | null
  loading: boolean
  fetchSources: () => Promise<void>
  addSource: (source: string) => Promise<void>
  deleteSource: (source: string) => Promise<void>
}

export const useModelSources = create<ModelSourcesState>()((set) => ({
  sources: [],
  error: null,
  loading: false,

  fetchSources: async () => {
    set({ loading: true, error: null })
    try {
      const sources = await fetchModelSources()
      set({ sources, loading: false })
    } catch (error) {
      set({ error: error as Error, loading: false })
    }
  },

  addSource: async (source: string) => {
    set({ loading: true, error: null })
    try {
      await addModelSource(source)
      const sources = await fetchModelSources()
      set({ sources, loading: false })
    } catch (error) {
      set({ error: error as Error, loading: false })
    }
  },

  deleteSource: async (source: string) => {
    set({ loading: true, error: null })
    try {
      await deleteModelSource(source)
      const sources = await fetchModelSources()
      set({ sources, loading: false })
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
