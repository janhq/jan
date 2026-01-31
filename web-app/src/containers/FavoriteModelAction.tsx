import { IconStar, IconStarFilled } from '@tabler/icons-react'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { Button } from '@/components/ui/button'

interface FavoriteModelActionProps {
  model: Model
}

export function FavoriteModelAction({ model }: FavoriteModelActionProps) {
  const { isFavorite, toggleFavorite } = useFavoriteModel()
  const isModelFavorite = isFavorite(model.id)

  return (
    <Button
      aria-label="Toggle favorite" 
      variant="ghost"
      size="icon-xs"
      onClick={() => toggleFavorite(model)}
    >
      {isModelFavorite ? (
        <IconStarFilled size={18} className="text-muted-foreground" />
      ) : (
        <IconStar size={18} className="text-muted-foreground" />
      )}
    </Button>
  )
}
