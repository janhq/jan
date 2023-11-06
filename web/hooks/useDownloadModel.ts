import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model, ModelCatalog, ModelVersion } from '@janhq/core/lib/types'

import { useAtom } from 'jotai'

import { useDownloadState } from './useDownloadState'

import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'
import { pluginManager } from '@/plugin/PluginManager'

export default function useDownloadModel() {
  const { setDownloadState } = useDownloadState()
  const [downloadingModels, setDownloadingModels] = useAtom(
    downloadingModelsAtom
  )

  const assistanModel = (
    model: ModelCatalog,
    modelVersion: ModelVersion
  ): Model => {
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      _id: modelVersion._id,
      name: modelVersion.name,
      quantMethod: modelVersion.quantMethod,
      bits: modelVersion.bits,
      size: modelVersion.size,
      maxRamRequired: modelVersion.maxRamRequired,
      usecase: modelVersion.usecase,
      downloadLink: modelVersion.downloadLink,
      startDownloadAt: modelVersion.startDownloadAt,
      finishDownloadAt: modelVersion.finishDownloadAt,
      productId: model._id,
      productName: model.name,
      shortDescription: model.shortDescription,
      longDescription: model.longDescription,
      avatarUrl: model.avatarUrl,
      author: model.author,
      version: model.version,
      modelUrl: model.modelUrl,
      createdAt: new Date(model.createdAt).getTime(),
      updatedAt: new Date(model.updatedAt ?? '').getTime(),
      status: '',
      releaseDate: -1,
      tags: model.tags,
    }
  }

  const downloadModel = async (
    model: ModelCatalog,
    modelVersion: ModelVersion
  ) => {
    // set an initial download state
    setDownloadState({
      modelId: modelVersion._id,
      time: {
        elapsed: 0,
        remaining: 0,
      },
      speed: 0,
      percent: 0,
      size: {
        total: 0,
        transferred: 0,
      },
      fileName: modelVersion._id,
    })

    modelVersion.startDownloadAt = Date.now()
    const assistantModel = assistanModel(model, modelVersion)

    setDownloadingModels([...downloadingModels, assistantModel])

    await pluginManager
      .get<ModelPlugin>(PluginType.Model)
      ?.downloadModel(assistantModel)
  }

  return {
    downloadModel,
  }
}
