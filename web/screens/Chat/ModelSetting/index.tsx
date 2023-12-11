import { useEffect, useState } from 'react'

import { useForm } from 'react-hook-form'

import { ModelRuntimeParams } from '@janhq/core'
import { Button } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { presetConfiguration } from './predefinedComponent'
import settingComponentBuilder, {
  SettingComponentData,
} from './settingComponentBuilder'

import {
  getActiveThreadIdAtom,
  getActiveThreadModelRuntimeParamsAtom,
} from '@/helpers/atoms/Thread.atom'

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
      if ('value' in componentSetting.controllerData) {
        componentSetting.controllerData.value = Number(
          modelParams[key as keyof ModelRuntimeParams]
        )
      } else if ('checked' in componentSetting.controllerData) {
        componentSetting.controllerData.checked = modelParams[
          key as keyof ModelRuntimeParams
        ] as boolean
      }
      componentData.push(componentSetting)
    }
  })

  const onSubmit = (data: ModelRuntimeParams) => {
    if (!threadId) return
    console.log(data)
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
