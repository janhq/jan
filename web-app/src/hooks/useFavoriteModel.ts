import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

/** A favorited model is keyed by provider + id so identically-named models
 * from different providers do not collapse into one entry (#8442). */
export type FavoriteModel = Model & {
  provider: string
}

interface FavoriteModelState {
  favoriteModels: FavoriteModel[]
  addFavorite: (model: Model, provider: string) => void
  removeFavorite: (modelId: string, provider?: string) => void
  isFavorite: (modelId: string, provider?: string) => boolean
  toggleFavorite: (model: Model, provider: string) => void
}

const sameFavorite = (
  fav: FavoriteModel,
  modelId: string,
  provider?: string
) => {
  if (fav.id !== modelId) return false
  // Legacy favorites (pre-#8442) have no provider — match by id only so they
  // can still be removed / de-starred. New favorites always store provider.
  if (!fav.provider) return true
  if (!provider) return true
  return fav.provider === provider
}

export const useFavoriteModel = create<FavoriteModelState>()(
  persist(
    (set, get) => ({
      favoriteModels: [],

      addFavorite: (model: Model, provider: string) => {
        set((state) => {
          if (
            state.favoriteModels.some((fav) =>
              sameFavorite(fav, model.id, provider)
            )
          ) {
            return state
          }
          return {
            favoriteModels: [
              ...state.favoriteModels,
              { ...model, provider },
            ],
          }
        })
      },

      removeFavorite: (modelId: string, provider?: string) => {
        set((state) => ({
          favoriteModels: state.favoriteModels.filter(
            (model) => !sameFavorite(model, modelId, provider)
          ),
        }))
      },

      isFavorite: (modelId: string, provider?: string) => {
        return get().favoriteModels.some((model) =>
          sameFavorite(model, modelId, provider)
        )
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
    }
  )
)
