import {
  Model,
  ExtensionType,
  ModelExtension,
  ModelArtifact,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import {
  addNewDownloadingModelAtom,
  setDownloadStateAtom,
} from './useDownloadState'

import { extensionManager } from '@/extension/ExtensionManager'

export default function useDownloadModel() {
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const addNewDownloadingModel = useSetAtom(addNewDownloadingModelAtom)

  const downloadModel = async (model: Model) => {
    const childrenDownloadProgress: DownloadState[] = []
    model.source.forEach((source: ModelArtifact) => {
      childrenDownloadProgress.push({
        modelId: source.filename,
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
    })

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
      children: childrenDownloadProgress,
    })

    addNewDownloadingModel(model)

    await extensionManager
      .get<ModelExtension>(ExtensionType.Model)
      ?.downloadModel(model)
  }

  return {
    downloadModel,
  }
}
