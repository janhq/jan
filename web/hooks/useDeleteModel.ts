import { useCallback } from 'react'

import { Model } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

import { removeDownloadedModelAtom } from '@/helpers/atoms/Model.atom'

const useDeleteModel = () => {
  const removeDownloadedModel = useSetAtom(removeDownloadedModelAtom)
  const { deleteModel: cortexDeleteModel } = useCortex()

  const deleteModel = useCallback(
    async (model: Model) => {
      await cortexDeleteModel(model.id)
      removeDownloadedModel(model.id)
      toaster({
        title: 'Model Deletion Successful',
        description: `Model ${model.name} has been successfully deleted.`,
        type: 'success',
      })
    },
    [removeDownloadedModel, cortexDeleteModel]
  )

  return { deleteModel }
}

export default useDeleteModel
