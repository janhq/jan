/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  EventName,
  ExtensionType,
  InferenceExtension,
  events,
} from '@janhq/core'
import { Model, ModelSettingParams } from '@janhq/core'
import { atom, useAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from './useGetDownloadedModels'

import { extensionManager } from '@/extension'

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

    events.emit(EventName.OnModelInit, model)
  }

  const stopModel = async (modelId: string) => {
    setStateModel({ state: 'stop', loading: true, model: modelId })
    events.emit(EventName.OnModelStop, modelId)
  }

  return { activeModel, startModel, stopModel, stateModel }
}
