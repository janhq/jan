import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

interface FavoriteModelState {
  favoriteModels: Model[]
  addFavorite: (model: Model) => void
  removeFavorite: (modelId: string) => void
  isFavorite: (modelId: string) => boolean
  toggleFavorite: (model: Model) => void
}

export const useFavoriteModel = create<FavoriteModelState>()(
  persist(
    (set, get) => ({
      favoriteModels: [],
      
      addFavorite: (model: Model) => {
        set((state) => {
          if (!state.favoriteModels.some((fav) => fav.id === model.id)) {
            return {
              favoriteModels: [...state.favoriteModels, model],
            }
          }
          return state
        })
      },
      
      removeFavorite: (modelId: string) => {
        set((state) => ({
          favoriteModels: state.favoriteModels.filter((model) => model.id !== modelId),
        }))
      },
      
      isFavorite: (modelId: string) => {
        return get().favoriteModels.some((model) => model.id === modelId)
      },
      
      toggleFavorite: (model: Model) => {
        const { isFavorite, addFavorite, removeFavorite } = get()
        if (isFavorite(model.id)) {
          removeFavorite(model.id)
        } else {
          addFavorite(model)
        }
      },
    }),
    {
      name: localStorageKey.favoriteModels,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
