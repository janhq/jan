import { useCallback, useEffect, useRef } from 'react'

import { EngineManager, Model } from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { LAST_USED_MODEL_ID } from './useRecommendedModel'

import { vulkanEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

export const activeModelAtom = atom<Model | undefined>(undefined)
export const loadModelErrorAtom = atom<string | undefined>(undefined)

type ModelState = {
  state: string
  loading: boolean
  model?: Model
}

export const stateModelAtom = atom<ModelState>({
  state: 'start',
  loading: false,
  model: undefined,
})

const pendingModelLoadAtom = atom<boolean>(false)

export function useActiveModel() {
  const [activeModel, setActiveModel] = useAtom(activeModelAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const [stateModel, setStateModel] = useAtom(stateModelAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setLoadModelError = useSetAtom(loadModelErrorAtom)
  const [pendingModelLoad, setPendingModelLoad] = useAtom(pendingModelLoadAtom)
  const isVulkanEnabled = useAtomValue(vulkanEnabledAtom)

  const downloadedModelsRef = useRef<Model[]>([])

  useEffect(() => {
    downloadedModelsRef.current = downloadedModels
  }, [downloadedModels])

  const startModel = async (modelId: string, abortable: boolean = true) => {
    if (
      (activeModel && activeModel.id === modelId) ||
      (stateModel.model?.id === modelId && stateModel.loading)
    ) {
      console.debug(`Model ${modelId} is already initialized. Ignore..`)
      return Promise.resolve()
    }

    if (activeModel) {
      stopModel(activeModel)
    }
    setPendingModelLoad(true)

    let model = downloadedModelsRef?.current.find((e) => e.id === modelId)

    setLoadModelError(undefined)

    setActiveModel(undefined)

    setStateModel({ state: 'start', loading: true, model })

    if (!model) {
      toaster({
        title: `Model ${modelId} not found!`,
        description: `Please download the model first.`,
        type: 'warning',
      })
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: undefined,
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

    if (isVulkanEnabled) {
      // @ts-expect-error flash_attn is newly added and will be migrate to cortex in the future
      model.settings['flash_attn'] = false
    }

    localStorage.setItem(LAST_USED_MODEL_ID, model.id)
    const engine = EngineManager.instance().get(model.engine)
    return engine
      ?.loadModel(model)
      .then(() => {
        setActiveModel(model)
        setStateModel(() => ({
          state: 'stop',
          loading: false,
          model,
        }))
        toaster({
          title: 'Success!',
          description: `Model ${model.id} has been started.`,
          type: 'success',
        })
      })
      .catch((error) => {
        setStateModel(() => ({
          state: 'start',
          loading: false,
          undefined,
        }))

        if (!pendingModelLoad && abortable) {
          return Promise.reject(new Error('aborted'))
        }

        toaster({
          title: 'Failed!',
          description: `Model ${model.id} failed to start.`,
          type: 'error',
        })
        setLoadModelError(error)
        return Promise.reject(error)
      })
  }

  const stopModel = useCallback(
    async (model?: Model) => {
      const stoppingModel = model ?? activeModel ?? stateModel.model
      if (!stoppingModel || (stateModel.state === 'stop' && stateModel.loading))
        return

      const engine = EngineManager.instance().get(stoppingModel.engine)
      return engine
        ?.unloadModel(stoppingModel)
        .catch((e) => console.error(e))
        .then(() => {
          setActiveModel(undefined)
          setStateModel({ state: 'start', loading: false, model: undefined })
          setPendingModelLoad(false)
        })
    },
    [
      activeModel,
      setStateModel,
      setActiveModel,
      setPendingModelLoad,
      stateModel,
    ]
  )

  const stopInference = useCallback(async () => {
    // Loading model
    if (stateModel.loading) {
      stopModel()
      return
    }
    if (!activeModel) return

    const engine = EngineManager.instance().get(activeModel.engine)
    engine?.stopInference()
  }, [activeModel, stateModel, stopModel])

  return { activeModel, startModel, stopModel, stopInference, stateModel }
}
