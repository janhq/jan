import { ModelSettingParams } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { toSettingParams } from '@/utils/model_param'

import { presetConfiguration } from '../ModelSetting/predefinedComponent'
import settingComponentBuilder, {
  SettingComponentData,
} from '../ModelSetting/settingComponentBuilder'

import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const EngineSetting: React.FC = () => {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  if (!selectedModel || !activeModelParams) return null

  const modelSettingParams = toSettingParams(activeModelParams)

  const componentData: SettingComponentData[] = []
  Object.keys(modelSettingParams).forEach((key) => {
    const componentSetting = presetConfiguration[key]

    if (componentSetting) {
      if ('slider' === componentSetting.controllerType) {
        const value = Number(
          modelSettingParams[key as keyof ModelSettingParams]
        )
        componentSetting.controllerData.value = value
      } else if ('input' === componentSetting.controllerType) {
        const value = modelSettingParams[
          key as keyof ModelSettingParams
        ] as string
        const placeholder = modelSettingParams[
          key as keyof ModelSettingParams
        ] as string
        componentSetting.controllerData.value = value
        componentSetting.controllerData.placeholder = placeholder
      } else if ('checkbox' === componentSetting.controllerType) {
        const checked = modelSettingParams[
          key as keyof ModelSettingParams
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

export default EngineSetting
