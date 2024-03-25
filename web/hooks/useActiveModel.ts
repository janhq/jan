import { useCallback, useEffect, useRef } from 'react'

import { EngineManager, Model } from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { LAST_USED_MODEL_ID } from './useRecommendedModel'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

export const activeModelAtom = atom<Model | undefined>(undefined)
export const loadModelErrorAtom = atom<string | undefined>(undefined)

export const stateModelAtom = atom({
  state: 'start',
  loading: false,
  model: '',
})

export function useActiveModel() {
  const [activeModel, setActiveModel] = useAtom(activeModelAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const [stateModel, setStateModel] = useAtom(stateModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setLoadModelError = useSetAtom(loadModelErrorAtom)

  const downloadedModelsRef = useRef<Model[]>([])

  useEffect(() => {
    downloadedModelsRef.current = downloadedModels
  }, [downloadedModels])

  const startModel = async (modelId: string) => {
    if (
      (activeModel && activeModel.id === modelId) ||
      (stateModel.model === modelId && stateModel.loading)
    ) {
      console.debug(`Model ${modelId} is already initialized. Ignore..`)
      return Promise.resolve()
    }

    let model = downloadedModelsRef?.current.find((e) => e.id === modelId)

    await stopModel().catch()

    setLoadModelError(undefined)

    setActiveModel(undefined)

    setStateModel({ state: 'start', loading: true, model: modelId })

    if (!model) {
      toaster({
        title: `Model ${modelId} not found!`,
        description: `Please download the model first.`,
        type: 'warning',
      })
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: '',
      }))

      return Promise.reject(`Model ${modelId} not found!`)
    }

    /// Apply thread model settings
    if (activeThread?.assistants[0]?.model.id === modelId) {
      model = {
        ...model,
        settings: {
          ...model.settings,
          ...activeThread.assistants[0].model.settings,
        },
      }
    }

    localStorage.setItem(LAST_USED_MODEL_ID, model.id)
    const engine = EngineManager.instance()?.get(model.engine)
    return engine
      ?.loadModel(model)
      .then(() => {
        setActiveModel(model)
        setStateModel(() => ({
          state: 'stop',
          loading: false,
          model: model.id,
        }))
        toaster({
          title: 'Success!',
          description: `Model ${model.id} has been started.`,
          type: 'success',
        })
      })
      .catch((error) => {
        console.error('Failed to load model: ', error)
        setStateModel(() => ({
          state: 'start',
          loading: false,
          model: model.id,
        }))

        toaster({
          title: 'Failed!',
          description: `Model ${model.id} failed to start.`,
          type: 'success',
        })
        setLoadModelError(error)
      })
  }

  const stopModel = useCallback(async () => {
    if (activeModel) {
      setStateModel({ state: 'stop', loading: true, model: activeModel.id })
      const engine = EngineManager.instance()?.get(activeModel.engine)
      await engine
        ?.unloadModel(activeModel)
        .catch()
        .then(() => {
          setActiveModel(undefined)
          setStateModel({ state: 'start', loading: false, model: '' })
        })
    }
  }, [activeModel, setActiveModel, setStateModel])

  return { activeModel, startModel, stopModel, stateModel }
}
