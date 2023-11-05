import { toaster } from '@/containers/Toast'
import {
  getDownloadedModels,
  useGetDownloadedModels,
} from '@/hooks/useGetDownloadedModels'
import { pluginManager } from '@plugin/PluginManager'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'
import { PluginType } from '@janhq/core'

export default function useDeleteModel() {
  const { setDownloadedModels } = useGetDownloadedModels()

  const deleteModel = async (model: Model) => {
    await pluginManager
      .get<ModelPlugin>(PluginType.Model)
      ?.deleteModel(model._id)

    // reload models
    const downloadedModels = await getDownloadedModels()
    setDownloadedModels(downloadedModels)
    toaster({
      title: 'Delete a Model',
      description: `Model ${model._id} has been deleted.`,
    })
  }

  return { deleteModel }
}
