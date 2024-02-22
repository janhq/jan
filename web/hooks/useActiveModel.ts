import { events, Model, ModelEvent } from '@janhq/core'
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

  const startModel = async (modelId: string) => {
    if (
      (activeModel && activeModel.id === modelId) ||
      (stateModel.model === modelId && stateModel.loading)
    ) {
      console.debug(`Model ${modelId} is already initialized. Ignore..`)
      return
    }
    // TODO: incase we have multiple assistants, the configuration will be from assistant
    setLoadModelError(undefined)

    setActiveModel(undefined)

    setStateModel({ state: 'start', loading: true, model: modelId })

    let model = downloadedModels.find((e) => e.id === modelId)

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
      return
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
    events.emit(ModelEvent.OnModelInit, model)
  }

  const stopModel = async () => {
    if (activeModel) {
      setActiveModel(undefined)
      setStateModel({ state: 'stop', loading: true, model: activeModel.id })
      events.emit(ModelEvent.OnModelStop, activeModel)
    }
  }

  return { activeModel, startModel, stopModel, stateModel }
}
