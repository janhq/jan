/* eslint-disable @typescript-eslint/no-explicit-any */
import { InferenceService } from '@janhq/core'
import { atom, useAtom } from 'jotai'

import { executeSerial } from '@/services/pluginService'

import { useGetModelById } from './useGetModelById'

const activeAssistantModelAtom = atom<AssistantModel | undefined>(undefined)

const stateModelAtom = atom({ state: 'start', loading: false, model: '' })

export function useActiveModel() {
  const [activeModel, setActiveModel] = useAtom(activeAssistantModelAtom)
  const [stateModel, setStateModel] = useAtom(stateModelAtom)
  const { getModelById } = useGetModelById()

  const startModel = async (modelId: string) => {
    if (activeModel && activeModel._id === modelId) {
      console.debug(`Model ${modelId} is already init. Ignore..`)
      return
    }

    setStateModel({ state: 'start', loading: true, model: modelId })

    const model = await getModelById(modelId)

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

    const res = await initModel(modelId)
    if (res?.error) {
      const errorMessage = `Failed to init model: ${res.error}`
      console.error(errorMessage)
      alert(errorMessage)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: '',
      }))
    } else {
      console.debug(
        `Init model ${modelId} successfully!, take ${
          Date.now() - currentTime
        }ms`
      )
      setActiveModel(model)
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
      await executeSerial(InferenceService.StopModel, modelId)
      setActiveModel(undefined)
      setStateModel({ state: 'start', loading: false, model: '' })
    }, 500)
  }

  return { activeModel, startModel, stopModel, stateModel }
}

const initModel = async (modelId: string): Promise<any> => {
  return executeSerial(InferenceService.InitModel, modelId)
}
