import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Box } from 'lucide-react'
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { Button } from '@/components/ui/button'
import { Jan } from '@/components/ui/svgs/jan'
import { useModels } from '@/stores/models-store'
import { useProfile } from '@/stores/profile-store'
import { cn } from '@/lib/utils'

export function ModelSelector() {
  const [open, setOpen] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const models = useModels((state) => state.models)
  const fetchPreferences = useProfile((state) => state.fetchPreferences)
  const updatePreferences = useProfile((state) => state.updatePreferences)
  const getModels = useModels((state) => state.getModels)
  const selectedModel = useModels((state) => state.selectedModel)
  const setSelectedModel = useModels((state) => state.setSelectedModel)
  const loading = useModels((state) => state.loading)

  useEffect(() => {
    const initialize = async () => {
      await getModels()
      try {
        const preferences = await fetchPreferences()
        const selectedModelId = preferences?.preferences.selected_model
        if (selectedModelId) {
          // Get fresh models from store (not stale closure value)
          const freshModels = useModels.getState().models
          const model = freshModels.find((m) => m.id === selectedModelId)
          if (model) {
            setSelectedModel(model)
          }
        }
      } catch (error) {
        console.error('Failed to fetch preferences:', error)
      }
      setIsReady(true)
    }
    initialize()
  }, [fetchPreferences, getModels, setSelectedModel])

  const handleSelectModel = (model: Model) => {
    setSelectedModel(model)
    updatePreferences({
      preferences: {
        selected_model: model.id,
      },
    })
    setOpen(false)
  }

  // Don't render until initialization is complete to prevent flashing
  if (!isReady) return null

  return (
    <DropDrawer open={open} onOpenChange={setOpen}>
      <DropDrawerTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'justify-between rounded-full',
            'animate-in fade-in duration-200'
          )}
        >
          <Jan className="size-4 shrink-0" />
          <span
            className={
              selectedModel?.model_display_name
                ? 'truncate'
                : 'truncate text-muted-foreground'
            }
          >
            {selectedModel?.model_display_name || 'Select a model'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropDrawerTrigger>
      <DropDrawerContent align="start" className="p-2 md:w-70">
        {!loading && (
          <>
            {models.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No models available
              </div>
            ) : (
              <>
                {models.map((model) => (
                  <DropDrawerItem
                    key={model.id}
                    onClick={() => handleSelectModel(model)}
                    icon={
                      selectedModel?.id === model.id ? (
                        <Check className="size-4" />
                      ) : undefined
                    }
                  >
                    <div className="flex items-start gap-3">
                      <Box className="size-4 shrink-0 text-muted-foreground mt-1" />
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-medium">
                          {model.model_display_name}
                        </span>
                        {model.owned_by && (
                          <span className="text-xs text-muted-foreground">
                            {model.owned_by}
                          </span>
                        )}
                      </div>
                    </div>
                  </DropDrawerItem>
                ))}
              </>
            )}
          </>
        )}
      </DropDrawerContent>
    </DropDrawer>
  )
}
