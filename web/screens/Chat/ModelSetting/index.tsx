/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams } from '@/utils/modelParam'

import SettingComponentBuilder from './SettingComponent'

import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const ModelSetting = () => {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  if (!selectedModel || !activeModelParams) return null

  const modelRuntimeParams = toRuntimeParams(activeModelParams)

  const componentData = getConfigurationsData(
    modelRuntimeParams,
    selectedModel
  ).toSorted((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="flex flex-col">
      <SettingComponentBuilder
        componentData={componentData}
        selector={(e) => e.name !== 'prompt_template'}
      />
    </div>
  )
}

export default React.memo(ModelSetting)
