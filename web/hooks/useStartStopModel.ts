import { PluginType } from '@janhq/core'
import { InferencePlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { activeModelAtom, stateModel } from '@helpers/atoms/Model.atom'
import { pluginManager } from '@plugin/PluginManager'
import { downloadedModelAtom } from '@helpers/atoms/DownloadedModel.atom'

export default function useStartStopModel() {
  const [activeModel, setActiveModel] = useAtom(activeModelAtom)
  const setStateModel = useSetAtom(stateModel)
  const models = useAtomValue(downloadedModelAtom)

  const startModel = async (modelId: string) => {
    if (activeModel && activeModel._id === modelId) {
      console.debug(`Model ${modelId} is already init. Ignore..`)
      return
    }

    setStateModel({ state: 'start', loading: true, model: modelId })

    const model = await models.find((model) => model._id == modelId)

    if (!model) {
      alert(`Model ${modelId} not found! Please re-download the model first.`)
      setStateModel((prev) => ({ ...prev, loading: false }))
      return
    }

    const currentTime = Date.now()
    console.debug('Init model: ', model._id)

    const res = await initModel(`models/${model._id}`)
    if (res?.error) {
      const errorMessage = `Failed to init model: ${res.error}`
      console.error(errorMessage)
      alert(errorMessage)
    } else {
      console.debug(
        `Init model ${modelId} successfully!, take ${
          Date.now() - currentTime
        }ms`
      )
      setActiveModel(model)
    }
    setStateModel((prev) => ({ ...prev, loading: false }))
  }

  const stopModel = async (modelId: string) => {
    setStateModel({ state: 'stop', loading: true, model: modelId })
    setTimeout(async () => {
      await pluginManager
        .get<InferencePlugin>(PluginType.Inference)
        ?.stopModel()
      setActiveModel(undefined)
      setStateModel({ state: 'stop', loading: false, model: modelId })
    }, 500)
  }

  return { startModel, stopModel }
}

const initModel = async (modelId: string): Promise<any> => {
  await pluginManager
    .get<InferencePlugin>(PluginType.Inference)
    ?.initModel(modelId)
}
