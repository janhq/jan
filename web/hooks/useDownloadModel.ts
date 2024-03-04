import { useCallback } from 'react'

import {
  Model,
  ExtensionTypeEnum,
  ModelExtension,
  abortDownload,
  joinPath,
  ModelArtifact,
  DownloadState,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { setDownloadStateAtom } from './useDownloadState'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  ignoreSslAtom,
  proxyAtom,
  proxyEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'
import { addDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

export default function useDownloadModel() {
  const ignoreSSL = useAtomValue(ignoreSslAtom)
  const proxy = useAtomValue(proxyAtom)
  const proxyEnabled = useAtomValue(proxyEnabledAtom)
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const addDownloadingModel = useSetAtom(addDownloadingModelAtom)

  const downloadModel = useCallback(
    async (model: Model) => {
      const childProgresses: DownloadState[] = model.sources.map(
        (source: ModelArtifact) => ({
          fileName: source.filename,
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
        fileName: '',
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

      await localDownloadModel(model, ignoreSSL, proxyEnabled ? proxy : '')
    },
    [ignoreSSL, proxy, proxyEnabled, addDownloadingModel, setDownloadState]
  )

  const abortModelDownload = useCallback(async (model: Model) => {
    for (const source of model.sources) {
      const path = await joinPath(['models', model.id, source.filename])
      await abortDownload(path)
    }
  }, [])

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
