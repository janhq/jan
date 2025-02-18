import { Model, SettingComponentProps } from '@janhq/core'

import { presetConfiguration } from './predefinedComponent'

export const getConfigurationsData = (
  settings: object,
  selectedModel?: Model
): SettingComponentProps[] => {
  const componentData: SettingComponentProps[] = []

  Object.keys(settings).forEach((key: string) => {
    const componentSetting = presetConfiguration[key]
    const keySetting = settings[key as keyof typeof settings]

    if (!componentSetting) {
      return
    }
    if ('slider' === componentSetting.controllerType) {
      const value = Number(keySetting)
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
            case 'temperature':
              componentSetting.controllerProps.max =
                selectedModel?.parameters?.max_temperature || 2
              break
            case 'ctx_len':
              componentSetting.controllerProps.max =
                selectedModel?.settings.ctx_len ||
                componentSetting.controllerProps.max ||
                2048
              break
            case 'ngl':
              componentSetting.controllerProps.max =
                selectedModel?.settings.ngl ||
                componentSetting.controllerProps.max ||
                100
          }
        }
      }
    } else if ('input' === componentSetting.controllerType) {
      const value =
        typeof keySetting === 'object' && Array.isArray(keySetting)
          ? // Support array input with text input
            // TODO: remove this when we support muti-tag input
            (keySetting as string[])
              .filter((e) => e.trim() !== '')
              .join(' ')
              .concat(
                // Keep last space to allow user to add new array element
                (keySetting as string[])[
                  (keySetting as string[]).length - 1
                ] === ''
                  ? ' '
                  : ''
              )
          : (keySetting as string)
      const placeholder = keySetting as string
      if ('value' in componentSetting.controllerProps)
        componentSetting.controllerProps.value = value
      if ('placeholder' in componentSetting.controllerProps)
        componentSetting.controllerProps.placeholder = placeholder
    } else if ('checkbox' === componentSetting.controllerType) {
      const checked = keySetting as boolean
      if ('value' in componentSetting.controllerProps)
        componentSetting.controllerProps.value = checked
    } else if ('tag' === componentSetting.controllerType) {
      if ('value' in componentSetting.controllerProps)
        componentSetting.controllerProps.value = keySetting as string
    }
    componentData.push(componentSetting)
  })

  return componentData
}
