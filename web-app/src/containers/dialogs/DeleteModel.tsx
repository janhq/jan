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
import { deleteModel } from '@/services/models'
import { getProviders } from '@/services/providers'

import { IconTrash } from '@tabler/icons-react'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

type DialogDeleteModelProps = {
  provider: ModelProvider
  modelId?: string
}

export const DialogDeleteModel = ({
  provider,
  modelId,
}: DialogDeleteModelProps) => {
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const { setProviders, deleteModel: deleteModelCache } = useModelProvider()

  const removeModel = async () => {
    deleteModelCache(selectedModelId)
    deleteModel(selectedModelId).then(() => {
      getProviders().then(setProviders)
      toast.success('Delete Model', {
        id: `delete-model-${selectedModel?.id}`,
        description: `Model ${selectedModel?.id} has been permanently deleted.`,
      })
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
        <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
          <IconTrash size={18} className="text-main-view-fg/50" />
        </div>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Model: {selectedModel.id}</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this model? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button variant="link" size="sm" className="hover:no-underline">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" size="sm" onClick={removeModel}>
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
