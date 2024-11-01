import { useCallback } from 'react'

import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension/ExtensionManager'

import {
  addDownloadingModelAtom,
  removeDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'

export default function useDownloadModel() {
  const removeDownloadingModel = useSetAtom(removeDownloadingModelAtom)
  const addDownloadingModel = useSetAtom(addDownloadingModelAtom)

  const downloadModel = useCallback(
    async (model: string, id?: string, name?: string) => {
      addDownloadingModel(id ?? model)
      downloadLocalModel(model, id, name).catch((error) => {
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
    [removeDownloadingModel, addDownloadingModel]
  )

  const abortModelDownload = useCallback(async (model: string) => {
    await cancelModelDownload(model)
  }, [])

  return {
    downloadModel,
    abortModelDownload,
  }
}

const downloadLocalModel = async (model: string, id?: string, name?: string) =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.pullModel(model, id, name)

const cancelModelDownload = async (model: string) =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.cancelModelPull(model)
