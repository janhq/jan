/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toSettingParams } from '@/utils/modelParam'

import SettingComponentBuilder from '../ModelSetting/SettingComponent'

import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const EngineSetting = ({ enabled = true }: { enabled?: boolean }) => {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  if (!selectedModel || !activeModelParams) return null

  const modelSettingParams = toSettingParams(activeModelParams)

  const componentData = getConfigurationsData(
    modelSettingParams,
    selectedModel
  ).toSorted((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="flex flex-col">
      <SettingComponentBuilder
        componentData={componentData}
        enabled={enabled}
        selector={(e) => e.name !== 'prompt_template'}
      />
    </div>
  )
}

export default EngineSetting
