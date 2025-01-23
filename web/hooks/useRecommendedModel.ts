import { useCallback, useEffect, useState } from 'react'

import { Model, InferenceEngine } from '@janhq/core'

import { atom, useAtomValue } from 'jotai'

import { activeModelAtom } from './useActiveModel'

import { useGetEngines } from './useEngineManagement'

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

export const lastUsedModel = atom<Model | undefined>(undefined)

export const LAST_USED_MODEL_ID = 'last-used-model-id'

/**
 * A hook that return the recommended model when user
 * wants to create a new thread.
 *
 * The precedence is as follows:
 * 1. Active model
 * 2. If no active model(s), then the last used model
 * 3. If no active or last used model, then the 1st model on the list
 */
export default function useRecommendedModel() {
  const activeModel = useAtomValue(activeModelAtom)
  const [sortedModels, setSortedModels] = useState<Model[]>([])
  const [recommendedModel, setRecommendedModel] = useState<Model | undefined>()
  const activeThread = useAtomValue(activeThreadAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const { engines } = useGetEngines()

  const getAndSortDownloadedModels = useCallback(async (): Promise<Model[]> => {
    const models = downloadedModels.sort((a, b) =>
      a.engine !== InferenceEngine.cortex_llamacpp &&
      b.engine === InferenceEngine.cortex_llamacpp
        ? 1
        : -1
    )
    setSortedModels(models)
    return models
  }, [downloadedModels])

  const getRecommendedModel = useCallback(async (): Promise<
    Model | undefined
  > => {
    const models = (await getAndSortDownloadedModels()).filter((e: Model) =>
      engines?.[e.engine]?.[0].type === 'local' ||
      (engines?.[e.engine]?.[0].api_key?.length ?? 0) > 0
        ? true
        : false
    )

    if (!activeThread || !activeAssistant) return
    const modelId = activeAssistant.model.id
    const model = models.find((model) => model.id === modelId)

    if (model) {
      setRecommendedModel(model)
    }

    if (activeModel) {
      // if we have active model alr, then we can just use that
      console.debug(`Using active model ${activeModel.id}`)
      setRecommendedModel(activeModel)
      return
    }

    // sort the model, for display purpose
    if (models.length === 0) {
      // if we have no downloaded models, then can't recommend anything
      setRecommendedModel(undefined)
      return
    }

    // otherwise, get the last used model id
    const lastUsedModelId = localStorage.getItem(LAST_USED_MODEL_ID)

    // if we don't have [lastUsedModelId], then we can just use the first model
    // in the downloaded list
    if (!lastUsedModelId) {
      setRecommendedModel(models[0])
      return
    }

    const lastUsedModel = models.find((model) => model.id === lastUsedModelId)
    if (!lastUsedModel) {
      // if we can't find the last used model, then we can just use the first model
      // in the downloaded list
      console.debug(
        `Last used model ${lastUsedModelId} not found, using first model in list ${models[0].id}}`
      )
      setRecommendedModel(models[0])
      return
    }

    setRecommendedModel(lastUsedModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAndSortDownloadedModels, activeThread, engines])

  useEffect(() => {
    getRecommendedModel()
  }, [getRecommendedModel])

  return {
    recommendedModel,
    downloadedModels: sortedModels,
    setRecommendedModel,
  }
}
