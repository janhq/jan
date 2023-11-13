/* eslint-disable @typescript-eslint/no-explicit-any */
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
    if (activeModel && activeModel._id === modelId) {
      console.debug(`Model ${modelId} is already init. Ignore..`)
      return
    }

    setStateModel({ state: 'start', loading: true, model: modelId })

    const model = await downloadedModels.find((e) => e._id === modelId)

    if (!modelId) {
      alert(`Model ${modelId} not found! Please re-download the model first.`)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: '',
      }))
      return
    }

    const currentTime = Date.now()
    console.debug('Init model: ', modelId)

    const res = await initModel(`models/${modelId}`)
    if (res?.error) {
      const errorMessage = `Failed to init model: ${res.error}`
      console.error(errorMessage)
      alert(errorMessage)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: modelId,
      }))
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
