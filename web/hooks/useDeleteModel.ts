import { ExtensionTypeEnum, ModelExtension, Model } from '@janhq/core'

import { useAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension/ExtensionManager'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

export default function useDeleteModel() {
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelsAtom)

  const deleteModel = async (model: Model) => {
    await extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.deleteModel(model.id)

    // reload models
    setDownloadedModels(downloadedModels.filter((e) => e.id !== model.id))
    toaster({
      title: 'Model Deletion Successful',
      description: `The model ${model.id} has been successfully deleted.`,
      type: 'success',
    })
  }

  return { deleteModel }
}
