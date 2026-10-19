import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

type FavoriteModel = Model & { provider?: string }

// Old records did not identify their provider. Bind only unambiguous matches;
// retain the rest without guessing ownership or starring every matching ID.
export function scopeLegacyFavorites(favorites: FavoriteModel[], providers: ModelProvider[]): FavoriteModel[] {
  return favorites.map((favorite) => {
    if (favorite.provider) return favorite
    const owners = providers.filter((provider) => provider.models.some((model) => model.id === favorite.id))
    return owners.length === 1 ? { ...favorite, provider: owners[0].provider } : favorite
  })
}

interface FavoriteModelState {
  favoriteModels: FavoriteModel[]
  addFavorite: (model: Model, provider: string) => void
  removeFavorite: (modelId: string, provider: string) => void
  isFavorite: (modelId: string, provider: string) => boolean
  toggleFavorite: (model: Model, provider: string) => void
}

export const useFavoriteModel = create<FavoriteModelState>()(
  persist(
    (set, get) => ({
      favoriteModels: [],
      
      addFavorite: (model: Model, provider: string) => {
        set((state) => {
          if (!state.favoriteModels.some((fav) => fav.id === model.id && fav.provider === provider)) {
            return {
              favoriteModels: [
                ...state.favoriteModels.filter((fav) => fav.id !== model.id || fav.provider),
                { ...model, provider },
              ],
            }
          }
          return state
        })
      },
      
      removeFavorite: (modelId: string, provider: string) => {
        set((state) => ({
          favoriteModels: state.favoriteModels.filter((model) => model.id !== modelId || model.provider !== provider),
        }))
      },
      
      isFavorite: (modelId: string, provider: string) => {
        return get().favoriteModels.some((model) => model.id === modelId && model.provider === provider)
      },
      
      toggleFavorite: (model: Model, provider: string) => {
        const { isFavorite, addFavorite, removeFavorite } = get()
        if (isFavorite(model.id, provider)) {
          removeFavorite(model.id, provider)
        } else {
          addFavorite(model, provider)
        }
      },
    }),
    {
      name: localStorageKey.favoriteModels,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      version: 1,
      migrate: async (persistedState) => {
        const state = persistedState as FavoriteModelState
        let providers: ModelProvider[] = []
        try {
          const stored = await backendStorage.getItem(localStorageKey.modelProvider)
          if (stored) {
            const parsed = JSON.parse(stored)
            if (Array.isArray(parsed?.state?.providers)) providers = parsed.state.providers
          }
        } catch (error) {
          console.error('Failed to resolve legacy favorite providers:', error)
        }
        return { ...state, favoriteModels: scopeLegacyFavorites(state.favoriteModels ?? [], providers) }
      },
    }
  )
)
