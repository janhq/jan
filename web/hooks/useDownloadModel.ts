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
      /**
       * Id will be used for the model file name
       * Should be the version name
       */
      id: modelVersion.name,
      name: model.name,
      quantizationName: modelVersion.quantizationName,
      bits: modelVersion.bits,
      size: modelVersion.size,
      maxRamRequired: modelVersion.maxRamRequired,
      usecase: modelVersion.usecase,
      downloadLink: modelVersion.downloadLink,
      shortDescription: model.shortDescription,
      longDescription: model.longDescription,
      avatarUrl: model.avatarUrl,
      author: model.author,
      version: model.version,
      modelUrl: model.modelUrl,
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
      modelId: modelVersion.name,
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
      fileName: modelVersion.name,
    })

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
