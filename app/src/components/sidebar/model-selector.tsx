import { useState, useMemo } from 'react'
import { Check, ChevronsUpDown, Loader2, Box } from 'lucide-react'
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerLabel,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { Button } from '@/components/ui/button'
import { Jan } from '@/components/ui/svgs/jan'
import { useModels, type Model } from '@/hooks/use-models'

export function ModelSelector() {
  const { models, loading, error } = useModels()
  const [open, setOpen] = useState(false)
  const [manuallySelectedModelId, setManuallySelectedModelId] = useState<
    string | null
  >(null)

  // Get the first model
  const firstModel = models.length > 0 ? models[0] : null

  // Compute selected model: use manually selected if available, otherwise use first model
  const selectedModel = useMemo(() => {
    if (manuallySelectedModelId) {
      return models.find((m) => m.id === manuallySelectedModelId) || null
    }
    return firstModel
  }, [manuallySelectedModelId, models, firstModel])

  const handleSelectModel = (model: Model) => {
    setManuallySelectedModelId(model.id)
    setOpen(false)
  }

  return (
    <DropDrawer open={open} onOpenChange={setOpen}>
      <DropDrawerTrigger asChild>
        <Button variant="outline" className="justify-between rounded-full">
          <Jan className="size-4 shrink-0" />
          <span
            className={
              selectedModel ? 'truncate' : 'truncate text-muted-foreground'
            }
          >
            {selectedModel?.model_display_name || 'Select a model'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropDrawerTrigger>
      <DropDrawerContent align="start" className="p-2 md:w-70">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="px-4 py-6 text-center text-sm text-destructive">
            {error.message}
          </div>
        )}
        {!loading && !error && (
          <>
            {models.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No models available
              </div>
            ) : (
              <>
                <DropDrawerLabel className="text-left">Model</DropDrawerLabel>
                <DropDrawerGroup>
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
                </DropDrawerGroup>
              </>
            )}
          </>
        )}
      </DropDrawerContent>
    </DropDrawer>
  )
}
