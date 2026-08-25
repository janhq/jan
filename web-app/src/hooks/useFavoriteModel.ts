import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

export interface FavoriteEntry {
  modelId: string
  provider: string
}

interface FavoriteModelState {
  favoriteModels: FavoriteEntry[]
  addFavorite: (modelId: string, provider: string) => void
  removeFavorite: (modelId: string, provider: string) => void
  removeFavoritesForProvider: (provider: string) => void
  isFavorite: (modelId: string, provider: string) => boolean
  toggleFavorite: (modelId: string, provider: string) => void
}

export const useFavoriteModel = create<FavoriteModelState>()(
  persist(
    (set, get) => ({
      favoriteModels: [],

      addFavorite: (modelId: string, provider: string) => {
        set((state) => {
          if (
            !state.favoriteModels.some(
              (fav) => fav.modelId === modelId && fav.provider === provider
            )
          ) {
            return {
              favoriteModels: [...state.favoriteModels, { modelId, provider }],
            }
          }
          return state
        })
      },

      removeFavorite: (modelId: string, provider: string) => {
        set((state) => ({
          favoriteModels: state.favoriteModels.filter(
            (fav) => !(fav.modelId === modelId && fav.provider === provider)
          ),
        }))
      },

      removeFavoritesForProvider: (provider: string) => {
        set((state) => ({
          favoriteModels: state.favoriteModels.filter(
            (fav) => fav.provider !== provider
          ),
        }))
      },

      isFavorite: (modelId: string, provider: string) => {
        return get().favoriteModels.some(
          (fav) => fav.modelId === modelId && fav.provider === provider
        )
      },

      toggleFavorite: (modelId: string, provider: string) => {
        const { isFavorite, addFavorite, removeFavorite } = get()
        if (isFavorite(modelId, provider)) {
          removeFavorite(modelId, provider)
        } else {
          addFavorite(modelId, provider)
        }
      },
    }),
    {
      name: localStorageKey.favoriteModels,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 || version === undefined) {
          // Migrate from old Model[] format to FavoriteEntry[] format.
          // Old entries had an 'id' field (Model.id); we drop provider info
          // since it was not stored — the favorites list will be cleared.
          return { favoriteModels: [] }
        }
        return persistedState as FavoriteModelState
      },
    }
  )
)