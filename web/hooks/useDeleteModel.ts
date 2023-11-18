import { join } from 'path'

import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { pluginManager } from '@/plugin/PluginManager'

export default function useDeleteModel() {
  const { setDownloadedModels, downloadedModels } = useGetDownloadedModels()

  const deleteModel = async (model: Model) => {
    const path = join('models', model.name, model.id)
    await pluginManager.get<ModelPlugin>(PluginType.Model)?.deleteModel(path)

    // reload models
    setDownloadedModels(downloadedModels.filter((e) => e.id !== model.id))
    toaster({
      title: 'Delete a Model',
      description: `Model ${model.id} has been deleted.`,
    })
  }

  return { deleteModel }
}
