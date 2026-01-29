import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'

import { IconTrash } from '@tabler/icons-react'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'

type DialogDeleteModelProps = {
  provider: ModelProvider
  modelId?: string
}

export const DialogDeleteModel = ({
  provider,
  modelId,
}: DialogDeleteModelProps) => {
  const { t } = useTranslation()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const { setProviders, deleteModel: deleteModelCache } = useModelProvider()
  const { removeFavorite } = useFavoriteModel()
  const serviceHub = useServiceHub()

  const removeModel = async () => {
    // Remove model from favorites if it exists
    removeFavorite(selectedModelId)

    deleteModelCache(selectedModelId)
    serviceHub
      .models()
      .deleteModel(selectedModelId)
      .then(() => {
        serviceHub
          .providers()
          .getProviders()
          .then((providers) => {
            // Filter out the deleted model from all providers
            const filteredProviders = providers.map((provider) => ({
              ...provider,
              models: provider.models.filter(
                (model) => model.id !== selectedModelId
              ),
            }))
            setProviders(filteredProviders)
          })
        toast.success(
          t('providers:deleteModel.title', { modelId: selectedModel?.id }),
          {
            id: `delete-model-${selectedModel?.id}`,
            description: t('providers:deleteModel.success', {
              modelId: selectedModel?.id,
            }),
          }
        )
      })
  }

  // Initialize with the provided model ID or the first model if available
  useEffect(() => {
    if (modelId) {
      setSelectedModelId(modelId)
    } else if (provider.models && provider.models.length > 0) {
      setSelectedModelId(provider.models[0].id)
    }
  }, [provider, modelId])

  // Get the currently selected model
  const selectedModel = provider.models.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.id === selectedModelId
  )

  if (!selectedModel) {
    return null
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="size-6 cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out">
          <IconTrash size={18} className="text-muted-foreground" />
        </div>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('providers:deleteModel.title', { modelId: selectedModel.id })}
          </DialogTitle>
          <DialogDescription>
            {t('providers:deleteModel.description')}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              {t('providers:deleteModel.cancel')}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" size="sm" onClick={removeModel} autoFocus>
              {t('providers:deleteModel.delete')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
