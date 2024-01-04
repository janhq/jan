/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventName, events, Model } from '@janhq/core'
import { atom, useAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from './useGetDownloadedModels'
import { LAST_USED_MODEL_ID } from './useRecommendedModel'

export const activeModelAtom = atom<Model | undefined>(undefined)

export const stateModelAtom = atom({
  state: 'start',
  loading: false,
  model: '',
})

export function useActiveModel() {
  const [activeModel, setActiveModel] = useAtom(activeModelAtom)
  const [stateModel, setStateModel] = useAtom(stateModelAtom)
  const { downloadedModels } = useGetDownloadedModels()

  const startModel = async (modelId: string) => {
    if (
      (activeModel && activeModel.id === modelId) ||
      (stateModel.model === modelId && stateModel.loading)
    ) {
      console.debug(`Model ${modelId} is already initialized. Ignore..`)
      return
    }
    // TODO: incase we have multiple assistants, the configuration will be from assistant

    setActiveModel(undefined)

    setStateModel({ state: 'start', loading: true, model: modelId })

    const model = downloadedModels.find((e) => e.id === modelId)

    if (!model) {
      toaster({
        title: `Model ${modelId} not found!`,
        description: `Please download the model first.`,
      })
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: '',
      }))
      return
    }

    localStorage.setItem(LAST_USED_MODEL_ID, model.id)
    events.emit(EventName.OnModelInit, model)
  }

  const stopModel = async () => {
    if (activeModel) {
      setActiveModel(undefined)
      setStateModel({ state: 'stop', loading: true, model: activeModel.id })
      events.emit(EventName.OnModelStop, activeModel)
    }
  }

  return { activeModel, startModel, stopModel, stateModel }
}
