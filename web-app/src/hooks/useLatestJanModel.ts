import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey, CACHE_EXPIRY_MS } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'

type LatestJanModelState = {
  model: CatalogModel | null
  lastFetchedAt: number | null
  loading: boolean
  error: boolean
  fetchLatestJanModel: (force?: boolean) => Promise<void>
}

export const useLatestJanModel = create<LatestJanModelState>()(
  persist(
    (set, get) => ({
      model: null,
      lastFetchedAt: null,
      loading: false,
      error: false,
      fetchLatestJanModel: async (force = false) => {
        const { lastFetchedAt, loading } = get()

        if (loading) return

        if (
          !force &&
          lastFetchedAt &&
          Date.now() - lastFetchedAt < CACHE_EXPIRY_MS
        ) {
          return
        }

        set({ loading: true, error: false })

        try {
          const result = await getServiceHub()
            .models()
            .fetchLatestJanModel()

          if (result) {
            set({
              model: result,
              lastFetchedAt: Date.now(),
              loading: false,
            })
          } else {
            set({ error: true, loading: false })
          }
        } catch {
          set({ error: true, loading: false })
        }
      },
    }),
    {
      name: localStorageKey.latestJanModel,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        model: state.model,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
)
