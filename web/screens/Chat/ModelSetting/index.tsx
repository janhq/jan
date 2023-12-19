import { useForm } from 'react-hook-form'

import { ModelRuntimeParams } from '@janhq/core'

import { useAtomValue } from 'jotai'

import { presetConfiguration } from './predefinedComponent'
import settingComponentBuilder, {
  SettingComponentData,
} from './settingComponentBuilder'

import { getActiveThreadModelRuntimeParamsAtom } from '@/helpers/atoms/Thread.atom'

export default function ModelSetting() {
  const { register } = useForm()
  const activeModelParams = useAtomValue(getActiveThreadModelRuntimeParamsAtom)

  if (!activeModelParams) {
    return null
  }

  const componentData: SettingComponentData[] = []
  Object.keys(activeModelParams).forEach((key) => {
    const componentSetting = presetConfiguration[key]

    if (componentSetting) {
      if ('value' in componentSetting.controllerData) {
        componentSetting.controllerData.value = Number(
          activeModelParams[key as keyof ModelRuntimeParams]
        )
      } else if ('checked' in componentSetting.controllerData) {
        const checked = activeModelParams[
          key as keyof ModelRuntimeParams
        ] as boolean

        componentSetting.controllerData.checked = checked
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
