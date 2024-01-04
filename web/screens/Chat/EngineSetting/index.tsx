/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toSettingParams } from '@/utils/model_param'

import settingComponentBuilder from '../ModelSetting/settingComponentBuilder'

import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const EngineSetting = () => {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  if (!selectedModel || !activeModelParams) return null

  const modelSettingParams = toSettingParams(activeModelParams)

  const componentData = getConfigurationsData(modelSettingParams)

  componentData.sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="flex flex-col">
      {settingComponentBuilder(componentData)}
    </div>
  )
}

export default EngineSetting
