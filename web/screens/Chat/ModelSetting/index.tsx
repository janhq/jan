import { useEffect, useState } from 'react'

import { useForm } from 'react-hook-form'

import { ModelRuntimeParams } from '@janhq/core'

import { useAtomValue } from 'jotai'

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

  const { register } = useForm()

  useEffect(() => {
    setModelParams(activeModelParams)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <form className="flex flex-col">
      {settingComponentBuilder(componentData, register)}
    </form>
  )
}
