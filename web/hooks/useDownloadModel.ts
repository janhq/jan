import { useCallback } from 'react'

import {
  events,
  ExtensionTypeEnum,
  ModelEvent,
  ModelExtension,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension/ExtensionManager'

import {
  addDownloadingModelAtom,
  removeDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'

export default function useDownloadModel() {
  const addDownloadingModel = useSetAtom(addDownloadingModelAtom)
  const removeDownloadingModel = useSetAtom(removeDownloadingModelAtom)

  const downloadModel = useCallback(
    async (model: string) => {
      addDownloadingModel(model)
      localDownloadModel(model).catch((error) => {
        if (error.message) {
          toaster({
            title: 'Download failed',
            description: error.message,
            type: 'error',
          })
        }

        removeDownloadingModel(model)
      })
    },
    [addDownloadingModel]
  )

  const abortModelDownload = useCallback(async (model: string) => {
    await cancelModelDownload(model)
  }, [])

  return {
    downloadModel,
    abortModelDownload,
  }
}

const localDownloadModel = async (model: string) =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.pullModel(model)

const cancelModelDownload = async (model: string) =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.cancelModelPull(model)
