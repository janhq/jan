import React from 'react'

import { ModelRuntimeParams } from '@janhq/core'

import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { toRuntimeParams } from '@/utils/model_param'

import { presetConfiguration } from './predefinedComponent'
import settingComponentBuilder, {
  SettingComponentData,
} from './settingComponentBuilder'

import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const ModelSetting: React.FC = () => {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  if (!selectedModel || !activeModelParams) return null

  const modelRuntimeParams = toRuntimeParams(activeModelParams)

  const componentData: SettingComponentData[] = []
  Object.keys(modelRuntimeParams).forEach((key) => {
    const componentSetting = presetConfiguration[key]

    if (componentSetting) {
      if ('slider' === componentSetting.controllerType) {
        const value = Number(
          modelRuntimeParams[key as keyof ModelRuntimeParams]
        )
        componentSetting.controllerData.value = value
      } else if ('input' === componentSetting.controllerType) {
        const value = modelRuntimeParams[
          key as keyof ModelRuntimeParams
        ] as string
        const placeholder = modelRuntimeParams[
          key as keyof ModelRuntimeParams
        ] as string
        componentSetting.controllerData.value = value
        componentSetting.controllerData.placeholder = placeholder
      } else if ('checkbox' === componentSetting.controllerType) {
        const checked = modelRuntimeParams[
          key as keyof ModelRuntimeParams
        ] as boolean

        componentSetting.controllerData.checked = checked
      }
      componentData.push(componentSetting)
    }
  })

  componentData.sort((a, b) => a.title.localeCompare(b.title))

  return (
    <form className="flex flex-col">
      {settingComponentBuilder(componentData)}
    </form>
  )
}

export default React.memo(ModelSetting)
