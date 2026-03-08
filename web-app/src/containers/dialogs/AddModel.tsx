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
          <Button variant="secondary" size="icon-xs">
            <IconPlus size={18} className="text-muted-foreground" />
          </Button>
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
          <div className="text-sm text-muted-foreground">
            <a
              href={provider.explore_models_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:underline"
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
            size="sm"
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
