import {
  getActiveThreadIdAtom,
  getActiveThreadModelRuntimeParamsAtom,
  threadStatesAtom,
} from '@/helpers/atoms/Thread.atom'
import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'
import { ModelRuntimeParams } from '@janhq/core'
import { Button } from '@janhq/uikit'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import settingComponentBuilder, {
  SettingComponentData,
  SliderData,
} from './settingComponentBuilder'
import { useForm } from 'react-hook-form'
import { presetConfiguration } from './predefinedComponent'

export default function ModelSetting() {
  const threadId = useAtomValue(getActiveThreadIdAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelRuntimeParamsAtom)
  const [modelParams, setModelParams] = useState<
    ModelRuntimeParams | undefined
  >(activeModelParams)
  const { updateModelParameter } = useUpdateModelParameters()
  const { register, handleSubmit } = useForm()

  useEffect(() => {
    console.log('activeModelParams', activeModelParams)
    setModelParams(activeModelParams)
  }, [threadId])

  if (!modelParams) {
    return <div>This thread has no model parameters</div>
  }

  const componentData: SettingComponentData[] = []
  Object.keys(modelParams).forEach((key) => {
    const componentSetting = presetConfiguration[key]
    if (componentSetting) {
      if (componentSetting.controllerType === 'slider') {
        componentSetting.controllerData.value = Number(modelParams[key])
      } else if (componentSetting.controllerType === 'checkbox') {
        componentSetting.controllerData.checked = modelParams[key]
      }
      componentData.push(componentSetting)
    }
  })

  const onSubmit = (data: ModelRuntimeParams) => {
    if (!threadId) return
    updateModelParameter(threadId, data)
  }

  return (
    <form className="flex flex-col" onSubmit={handleSubmit(onSubmit)}>
      {settingComponentBuilder(componentData, register)}
      <Button
        type="submit"
        block
        className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
      >
        Save
      </Button>
    </form>
  )
}
