import { Model, ModelRuntimeParams, ModelSettingParams } from '@janhq/core'

import { presetConfiguration } from '@/screens/Chat/ModelSetting/predefinedComponent'

import { SettingComponentData } from '@/screens/Chat/ModelSetting/settingComponentBuilder'

import { ModelParams } from '@/helpers/atoms/Thread.atom'

export const getConfigurationsData = (
  settings: ModelSettingParams | ModelRuntimeParams,
  selectedModel?: Model
) => {
  const componentData: SettingComponentData[] = []

  Object.keys(settings).forEach((key: string) => {
    const componentSetting = presetConfiguration[key]

    if (!componentSetting) {
      return
    }
    if ('slider' === componentSetting.controllerType) {
      const value = Number(settings[key as keyof ModelParams])
      if ('value' in componentSetting.controllerData) {
        componentSetting.controllerData.value = value
        if ('max' in componentSetting.controllerData) {
          switch (key) {
            case 'max_tokens':
              componentSetting.controllerData.max =
                selectedModel?.parameters.max_tokens || 4096
              break
            case 'ctx_len':
              componentSetting.controllerData.max =
                selectedModel?.settings.ctx_len || 4096
              break
          }
        }
      }
    } else if ('input' === componentSetting.controllerType) {
      const value = settings[key as keyof ModelParams] as string
      const placeholder = settings[key as keyof ModelParams] as string
      if ('value' in componentSetting.controllerData)
        componentSetting.controllerData.value = value
      if ('placeholder' in componentSetting.controllerData)
        componentSetting.controllerData.placeholder = placeholder
    } else if ('checkbox' === componentSetting.controllerType) {
      const checked = settings[key as keyof ModelParams] as boolean

      if ('checked' in componentSetting.controllerData)
        componentSetting.controllerData.checked = checked
    }
    componentData.push(componentSetting)
  })
  return componentData
}
