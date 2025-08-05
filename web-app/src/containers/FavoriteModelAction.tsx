import { IconStar, IconStarFilled } from '@tabler/icons-react'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'

interface FavoriteModelActionProps {
  model: Model
}

export function FavoriteModelAction({ model }: FavoriteModelActionProps) {
  const { isFavorite, toggleFavorite } = useFavoriteModel()
  const isModelFavorite = isFavorite(model.id)

  return (
    <div
      aria-label="Toggle favorite"
      className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
      onClick={() => toggleFavorite(model)}
    >
      {isModelFavorite ? (
        <IconStarFilled size={18} className="text-main-view-fg" />
      ) : (
        <IconStar size={18} className="text-main-view-fg/50" />
      )}
    </div>
  )
}
