import { executeSerial } from '@services/pluginService'
import { InferenceService } from '@janhq/core'
import { useAtom } from 'jotai'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'

export default function useInitModel() {
  const [activeModel, setActiveModel] = useAtom(activeAssistantModelAtom)

  const initModel = async (model: AssistantModel) => {
    if (activeModel && activeModel._id === model._id) {
      console.debug(`Model ${model._id} is already init. Ignore..`)
      return
    }

    const currentTime = Date.now()
    console.debug('Init model: ', model._id)

    const res = await executeSerial(InferenceService.InitModel, model._id)
    if (res?.error) {
      console.error('Failed to init model: ', res.error)
      return res
    } else {
      console.debug(
        `Init model successfully!, take ${Date.now() - currentTime}ms`
      )
      setActiveModel(model)
      return {}
    }
  }

  return { initModel }
}
