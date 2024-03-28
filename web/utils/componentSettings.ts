import { Model, SettingComponentProps } from '@janhq/core'

import { presetConfiguration } from '@/screens/Chat/ModelSetting/predefinedComponent'

export const getConfigurationsData = (
  settings: object,
  selectedModel?: Model
): SettingComponentProps[] => {
  const componentData: SettingComponentProps[] = []

  Object.keys(settings).forEach((key: string) => {
    const componentSetting = presetConfiguration[key]

    if (!componentSetting) {
      return
    }
    if ('slider' === componentSetting.controllerType) {
      const value = Number(settings[key as keyof typeof settings])
      if ('value' in componentSetting.controllerProps) {
        componentSetting.controllerProps.value = value
        if ('max' in componentSetting.controllerProps) {
          switch (key) {
            case 'max_tokens':
              componentSetting.controllerProps.max =
                selectedModel?.parameters.max_tokens ||
                componentSetting.controllerProps.max ||
                4096
              break
            case 'ctx_len':
              componentSetting.controllerProps.max =
                selectedModel?.settings.ctx_len ||
                componentSetting.controllerProps.max ||
                4096
              break
          }
        }
      }
    } else if ('input' === componentSetting.controllerType) {
      const value = settings[key as keyof typeof settings] as string
      const placeholder = settings[key as keyof typeof settings] as string
      if ('value' in componentSetting.controllerProps)
        componentSetting.controllerProps.value = value
      if ('placeholder' in componentSetting.controllerProps)
        componentSetting.controllerProps.placeholder = placeholder
    } else if ('checkbox' === componentSetting.controllerType) {
      const checked = settings[key as keyof typeof settings] as boolean

      if ('value' in componentSetting.controllerProps)
        componentSetting.controllerProps.value = checked
    }
    componentData.push(componentSetting)
  })
  return componentData
}
