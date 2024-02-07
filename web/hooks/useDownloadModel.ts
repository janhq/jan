import { useCallback, useContext } from 'react'

import {
  Model,
  ExtensionTypeEnum,
  ModelExtension,
  abortDownload,
  joinPath,
  ModelArtifact,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { modelBinFileName } from '@/utils/model'

import { setDownloadStateAtom } from './useDownloadState'

import { extensionManager } from '@/extension/ExtensionManager'
import { addDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

export default function useDownloadModel() {
  const { ignoreSSL, proxy } = useContext(FeatureToggleContext)
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const addDownloadingModel = useSetAtom(addDownloadingModelAtom)

  const downloadModel = useCallback(
    async (model: Model) => {
      const childProgresses: DownloadState[] = model.sources.map(
        (source: ModelArtifact) => ({
          filename: source.filename,
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
          downloadState: 'downloading',
        })
      )

      // set an initial download state
      setDownloadState({
        filename: '',
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
        children: childProgresses,
        downloadState: 'downloading',
      })

      addDownloadingModel(model)

      await localDownloadModel(model, ignoreSSL, proxy)
    },
    [ignoreSSL, proxy, addDownloadingModel, setDownloadState]
  )

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

const localDownloadModel = async (
  model: Model,
  ignoreSSL: boolean,
  proxy: string
) =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.downloadModel(model, { ignoreSSL, proxy })
