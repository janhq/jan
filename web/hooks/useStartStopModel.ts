import { executeSerial } from '@services/pluginService'
import { ModelManagementService, InferenceService } from '@janhq/core'
import useInitModel from './useInitModel'
import { useSetAtom } from 'jotai'
import { activeAssistantModelAtom, stateModel } from '@helpers/atoms/Model.atom'

export default function useStartStopModel() {
  const { initModel } = useInitModel()
  const setActiveModel = useSetAtom(activeAssistantModelAtom)
  const setStateModel = useSetAtom(stateModel)

  const startModel = async (modelId: string) => {
    setStateModel({ state: 'start', loading: true, model: modelId })
    const model = await executeSerial(
      ModelManagementService.GetModelById,
      modelId
    )
    if (!model) {
      alert(`Model ${modelId} not found! Please re-download the model first.`)
      setStateModel((prev) => ({ ...prev, loading: false }))
    } else {
      await initModel(model)
      setStateModel((prev) => ({ ...prev, loading: false }))
    }
  }

  const stopModel = async (modelId: string) => {
    setStateModel({ state: 'stop', loading: true, model: modelId })
    setTimeout(async () => {
      await executeSerial(InferenceService.StopModel, modelId)
      setActiveModel(undefined)
      setStateModel({ state: 'stop', loading: false, model: modelId })
    }, 500)
  }

  return { startModel, stopModel }
}
