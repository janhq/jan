/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path'

import { PluginType } from '@janhq/core'
import { InferencePlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'

import { atom, useAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from './useGetDownloadedModels'

import { pluginManager } from '@/plugin'

const activeAssistantModelAtom = atom<Model | undefined>(undefined)

const stateModelAtom = atom({ state: 'start', loading: false, model: '' })

export function useActiveModel() {
  const [activeModel, setActiveModel] = useAtom(activeAssistantModelAtom)
  const [stateModel, setStateModel] = useAtom(stateModelAtom)
  const { downloadedModels } = useGetDownloadedModels()

  const startModel = async (modelId: string) => {
    if (
      (activeModel && activeModel.id === modelId) ||
      (stateModel.model === modelId && stateModel.loading)
    ) {
      console.debug(`Model ${modelId} is already init. Ignore..`)
      return
    }

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

    const currentTime = Date.now()
    console.debug('Init model: ', modelId)
    const path = join('models', model.name, modelId)
    const res = await initModel(path)
    if (res?.error && (!activeModel?.id || modelId === activeModel?.id)) {
      const errorMessage = `${res.error}`
      alert(errorMessage)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: modelId,
      }))
      setActiveModel(undefined)
    } else {
      console.debug(
        `Init model ${modelId} successfully!, take ${
          Date.now() - currentTime
        }ms`
      )
      setActiveModel(model)
      toaster({
        title: 'Success start a Model',
        description: `Model ${modelId} has been started.`,
      })
      setStateModel(() => ({
        state: 'stop',
        loading: false,
        model: modelId,
      }))
    }
  }

  const stopModel = async (modelId: string) => {
    setStateModel({ state: 'stop', loading: true, model: modelId })
    setTimeout(async () => {
      pluginManager.get<InferencePlugin>(PluginType.Inference)?.stopModel()

      setActiveModel(undefined)
      setStateModel({ state: 'start', loading: false, model: '' })
      toaster({
        title: 'Success stop a Model',
        description: `Model ${modelId} has been stopped.`,
      })
    }, 500)
  }

  return { activeModel, startModel, stopModel, stateModel }
}

const initModel = async (modelId: string): Promise<any> => {
  return pluginManager
    .get<InferencePlugin>(PluginType.Inference)
    ?.initModel(modelId)
}
