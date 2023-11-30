import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { pluginManager } from '@/plugin/PluginManager'

export default function useDeleteModel() {
  const { setDownloadedModels, downloadedModels } = useGetDownloadedModels()

  const deleteModel = async (model: Model) => {
    await pluginManager
      .get<ModelPlugin>(PluginType.Model)
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
