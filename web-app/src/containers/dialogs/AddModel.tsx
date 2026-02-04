import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useProviderModels } from '@/hooks/useProviderModels'
import { ModelCombobox } from '@/containers/ModelCombobox'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { getProviderTitle } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { getModelCapabilities } from '@/lib/models'
import { toast } from 'sonner'

type DialogAddModelProps = {
  provider: ModelProvider
  trigger?: React.ReactNode
}

export const DialogAddModel = ({ provider, trigger }: DialogAddModelProps) => {
  const { t } = useTranslation()
  const { updateProvider } = useModelProvider()
  const [modelId, setModelId] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [isComboboxOpen, setIsComboboxOpen] = useState(false)

  // Fetch models from provider API (API key is optional)
  const { models, loading, error, refetch } = useProviderModels(
    provider.base_url ? provider : undefined
  )

  // Handle form submission
  const handleSubmit = () => {
    if (!modelId.trim()) return // Don't submit if model ID is empty

    if (provider.models.some((e) => e.id === modelId)) {
      toast.error(t('providers:addModel.modelExists'), {
        description: t('providers:addModel.modelExistsDesc'),
      })
      return // Don't submit if model ID already exists
    }

    // Create the new model
    const newModel = {
      id: modelId,
      model: modelId,
      name: modelId,
      capabilities: getModelCapabilities(provider.provider, modelId),
      version: '1.0',
    }

    // Update the provider with the new model
    const updatedModels = [...provider.models, newModel]
    updateProvider(provider.provider, {
      ...provider,
      models: updatedModels,
    })

    // Reset form and close dialog
    setModelId('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
<<<<<<< HEAD
          <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
            <IconPlus size={18} className="text-main-view-fg/50" />
          </div>
=======
          <Button variant="secondary" size="icon-xs">
            <IconPlus size={18} className="text-muted-foreground" />
          </Button>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        )}
      </DialogTrigger>
      <DialogContent
        onEscapeKeyDown={(e: KeyboardEvent) => {
          if (isComboboxOpen) {
            e.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('providers:addModel.title')}</DialogTitle>
          <DialogDescription>
            {t('providers:addModel.description', {
              provider: getProviderTitle(provider.provider),
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Model selection field - required */}
        <div className="space-y-2">
          <label
            htmlFor="model-id"
            className="text-sm font-medium inline-block"
          >
            {t('providers:addModel.modelId')}{' '}
            <span className="text-destructive">*</span>
          </label>
          <ModelCombobox
            key={`${provider.provider}-${provider.base_url || ''}`}
            value={modelId}
            onChange={setModelId}
            models={models}
            loading={loading}
            error={error}
            onRefresh={refetch}
            placeholder={t('providers:addModel.enterModelId')}
            onOpenChange={setIsComboboxOpen}
          />
        </div>

        {/* Explore models link */}
        {provider.explore_models_url && (
<<<<<<< HEAD
          <div className="text-sm text-main-view-fg/70">
=======
          <div className="text-sm text-muted-foreground">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            <a
              href={provider.explore_models_url}
              target="_blank"
              rel="noopener noreferrer"
<<<<<<< HEAD
              className="flex items-center gap-1 hover:underline text-primary"
=======
              className="flex items-center gap-1 hover:underline"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            >
              <span>
                {t('providers:addModel.exploreModels', {
                  provider: getProviderTitle(provider.provider),
                })}
              </span>
            </a>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="default"
<<<<<<< HEAD
=======
            size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            onClick={handleSubmit}
            disabled={!modelId.trim()}
          >
            {t('providers:addModel.addModel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
