import { Model } from '@janhq/core'

import { SettingComponentData } from '@/screens/Chat/ModelSetting/SettingComponent'
import { presetConfiguration } from '@/screens/Chat/ModelSetting/predefinedComponent'

export const getConfigurationsData = (
  settings: object,
  selectedModel?: Model
) => {
  const componentData: SettingComponentData[] = []

  Object.keys(settings).forEach((key: string) => {
    const componentSetting = presetConfiguration[key]

    if (!componentSetting) {
      return
    }
    if ('slider' === componentSetting.controllerType) {
      const value = Number(settings[key as keyof typeof settings])
      if ('value' in componentSetting.controllerData) {
        componentSetting.controllerData.value = value
        if ('max' in componentSetting.controllerData) {
          switch (key) {
            case 'max_tokens':
              componentSetting.controllerData.max =
                selectedModel?.parameters.max_tokens ||
                componentSetting.controllerData.max ||
                4096
              break
            case 'ctx_len':
              componentSetting.controllerData.max =
                selectedModel?.settings.ctx_len ||
                componentSetting.controllerData.max ||
                4096
              break
          }
        }
      }
    } else if ('input' === componentSetting.controllerType) {
      const value = settings[key as keyof typeof settings] as string
      const placeholder = settings[key as keyof typeof settings] as string
      if ('value' in componentSetting.controllerData)
        componentSetting.controllerData.value = value
      if ('placeholder' in componentSetting.controllerData)
        componentSetting.controllerData.placeholder = placeholder
    } else if ('checkbox' === componentSetting.controllerType) {
      const checked = settings[key as keyof typeof settings] as boolean

      if ('checked' in componentSetting.controllerData)
        componentSetting.controllerData.checked = checked
    }
    componentData.push(componentSetting)
  })
  return componentData
}
