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

export function ModelSelector() {
  const [open, setOpen] = useState(false)
  const models = useModels((state) => state.models)
  const fetchPreferences = useProfile((state) => state.fetchPreferences)
  const updatePreferences = useProfile((state) => state.updatePreferences)
  const getModels = useModels((state) => state.getModels)
  const selectedModel = useModels((state) => state.selectedModel)
  const setSelectedModel = useModels((state) => state.setSelectedModel)
  const loading = useModels((state) => state.loading)

  useEffect(() => {
    getModels()
    fetchPreferences()
      .then((preferences) => {
        const selectedModelId = preferences?.preferences.selected_model
        if (selectedModelId) {
          const model = models.find((m) => m.id === selectedModelId)
          if (model) {
            setSelectedModel(model)
          }
        }
      })
      .catch((error) => {
        console.error('Failed to fetch preferences:', error)
      })
  }, [fetchPreferences, getModels, models, setSelectedModel])

  const handleSelectModel = (model: Model) => {
    setSelectedModel(model)
    updatePreferences({
      preferences: {
        selected_model: model.id,
      },
    })
    setOpen(false)
  }

  return (
    <DropDrawer open={open} onOpenChange={setOpen}>
      <DropDrawerTrigger asChild>
        <div className="relative">
          <Button variant="outline" className="justify-between rounded-full">
            <Jan className="size-4 shrink-0" />
            <span
              className={
                selectedModel ? 'truncate' : 'truncate text-muted-foreground'
              }
            >
              {!loading &&
                (selectedModel?.model_display_name || 'Select a model')}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
          <img
            src="/hat.png"
            alt="Christmas tree"
            className="size-9 object-contain absolute -top-3.5 -right-3 pointer-events-none select-none"
          />
        </div>
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
