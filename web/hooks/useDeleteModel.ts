import { useCallback } from 'react'

import { ExtensionTypeEnum, ModelExtension, Model } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension/ExtensionManager'
import { removeDownloadedModelAtom } from '@/helpers/atoms/Model.atom'

export default function useDeleteModel() {
  const removeDownloadedModel = useSetAtom(removeDownloadedModelAtom)

  const deleteModel = useCallback(
    async (model: Model) => {
      await localDeleteModel(model.id)
      removeDownloadedModel(model.id)
      toaster({
        title: 'Model Deletion Successful',
        description: `Model ${model.name} has been successfully deleted.`,
        type: 'success',
      })
    },
    [removeDownloadedModel]
  )

  return { deleteModel }
}

const localDeleteModel = async (model: string) =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.deleteModel(model)
