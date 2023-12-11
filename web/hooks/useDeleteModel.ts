import { ExtensionType, ModelExtension, Model } from '@janhq/core'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { extensionManager } from '@/extension/ExtensionManager'

export default function useDeleteModel() {
  const { setDownloadedModels, downloadedModels } = useGetDownloadedModels()

  const deleteModel = async (model: Model) => {
    await extensionManager
      .get<ModelExtension>(ExtensionType.Model)
      ?.deleteModel(model.id)

    // reload models
    setDownloadedModels(downloadedModels.filter((e) => e.id !== model.id))
    toaster({
      title: 'Model Deletion Successful',
      description: `The model ${model.id} has been successfully deleted.`,
    })
  }

  return { deleteModel }
}
