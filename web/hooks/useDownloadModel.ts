import { Model, ExtensionType, ModelExtension } from '@janhq/core'

import { useAtom, useAtomValue } from 'jotai'

import { useDownloadState } from './useDownloadState'

import { extensionManager } from '@/extension/ExtensionManager'
import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'

export default function useDownloadModel() {
  const { setDownloadState } = useDownloadState()
  const [downloadingModels, setDownloadingModels] = useAtom(
    downloadingModelsAtom
  )

  const downloadModel = async (model: Model) => {
    // set an initial download state
    setDownloadState({
      modelId: model.id,
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
    })

    setDownloadingModels([...downloadingModels, model])
    await extensionManager
      .get<ModelExtension>(ExtensionType.Model)
      ?.downloadModel(model)
  }

  return {
    downloadModel,
  }
}
