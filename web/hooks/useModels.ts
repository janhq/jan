import { useCallback } from 'react'

import { useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

import {
  downloadedModelsAtom,
  removeDownloadedModelAtom,
} from '@/helpers/atoms/Model.atom'

const useModels = () => {
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)
  const removeDownloadedModel = useSetAtom(removeDownloadedModelAtom)
  const {
    fetchModels,
    stopModel: cortexStopModel,
    deleteModel: cortexDeleteModel,
    updateModel: cortexUpdateModel,
  } = useCortex()

  const getModels = useCallback(() => {
    const getDownloadedModels = async () => {
      const models = await fetchModels()
      setDownloadedModels(models)
    }
    getDownloadedModels()
  }, [setDownloadedModels, fetchModels])

  const stopModel = useCallback(
    async (modelId: string) => cortexStopModel(modelId),
    [cortexStopModel]
  )

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

  return { getModels, stopModel, deleteModel, updateModel }
}

export default useModels
