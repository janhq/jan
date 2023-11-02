import { PluginType } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { getDownloadedModels } from './useGetDownloadedModels'
import { pluginManager } from '@plugin/PluginManager'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'

import { downloadedModelAtom } from '@/helpers/atoms/DownloadedModel.atom'

export default function useDeleteModel() {
  const setDownloadedModels = useSetAtom(downloadedModelAtom)

  const deleteModel = async (model: Model) => {
    await pluginManager
      .get<ModelPlugin>(PluginType.Model)
      ?.deleteModel(model._id)

    // reload models
    const downloadedModels = await getDownloadedModels()
    setDownloadedModels(downloadedModels)
  }

  return { deleteModel }
}
