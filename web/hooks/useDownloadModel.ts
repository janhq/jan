import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'

import { useAtom } from 'jotai'

import { useDownloadState } from './useDownloadState'

import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'

import { pluginManager } from '@/plugin/PluginManager'

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
      fileName: model.id,
    })

    setDownloadingModels([...downloadingModels, model])
    await pluginManager.get<ModelPlugin>(PluginType.Model)?.downloadModel(model)
  }

  return {
    downloadModel,
  }
}
