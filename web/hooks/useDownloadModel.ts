import { useContext } from 'react'

import {
  Model,
  ExtensionTypeEnum,
  ModelExtension,
  abortDownload,
  joinPath,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { modelBinFileName } from '@/utils/model'

import { useDownloadState } from './useDownloadState'

import { extensionManager } from '@/extension/ExtensionManager'
import { addNewDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

export default function useDownloadModel() {
  const { ignoreSSL, proxy } = useContext(FeatureToggleContext)
  const { setDownloadState } = useDownloadState()
  const addNewDownloadingModel = useSetAtom(addNewDownloadingModelAtom)

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

    addNewDownloadingModel(model)

    await extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.downloadModel(model, { ignoreSSL, proxy })
  }
  const abortModelDownload = async (model: Model) => {
    await abortDownload(
      await joinPath(['models', model.id, modelBinFileName(model)])
    )
  }

  return {
    downloadModel,
    abortModelDownload,
  }
}
