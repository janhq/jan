import { useCallback } from 'react'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

import { removeDownloadedModelAtom } from '@/helpers/atoms/Model.atom'

const useModels = () => {
  const removeDownloadedModel = useSetAtom(removeDownloadedModelAtom)
  const { deleteModel: cortexDeleteModel, updateModel: cortexUpdateModel } =
    useCortex()

  const deleteModel = useCallback(
    async (modelId: string) => {
      await cortexDeleteModel(modelId)
      removeDownloadedModel(modelId)

      toaster({
        title: 'Model Deletion Successful',
        description: `Model ${modelId} has been successfully deleted.`,
        type: 'success',
      })
    },
    [removeDownloadedModel, cortexDeleteModel]
  )

  const updateModel = useCallback(
    async (modelId: string, modelSettings: Record<string, unknown>) =>
      cortexUpdateModel(modelId, modelSettings),
    [cortexUpdateModel]
  )

  return { deleteModel, updateModel }
}

export default useModels
