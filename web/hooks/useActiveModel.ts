/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExtensionType, InferenceExtension } from '@janhq/core'
import { Model, ModelSettingParams } from '@janhq/core'
import { atom, useAtom } from 'jotai'

import { toaster } from '@/containers/Toast'

import { useGetDownloadedModels } from './useGetDownloadedModels'

import { extensionManager } from '@/extension'

const activeModelAtom = atom<Model | undefined>(undefined)

const stateModelAtom = atom({ state: 'start', loading: false, model: '' })

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

    const currentTime = Date.now()
    const res = await initModel(modelId, model?.settings)
    if (res && res.error) {
      const errorMessage = `${res.error}`
      alert(errorMessage)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: modelId,
      }))
    } else {
      console.debug(
        `Model ${modelId} successfully initialized! Took ${
          Date.now() - currentTime
        }ms`
      )
      setActiveModel(model)
      toaster({
        title: 'Success!',
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
      extensionManager
        .get<InferenceExtension>(ExtensionType.Inference)
        ?.stopModel()

      setActiveModel(undefined)
      setStateModel({ state: 'start', loading: false, model: '' })
      toaster({
        title: 'Success!',
        description: `Model ${modelId} has been stopped.`,
      })
    }, 500)
  }

  return { activeModel, startModel, stopModel, stateModel }
}

const initModel = async (
  modelId: string,
  settings?: ModelSettingParams
): Promise<any> => {
  return extensionManager
    .get<InferenceExtension>(ExtensionType.Inference)
    ?.initModel(modelId, settings)
}
