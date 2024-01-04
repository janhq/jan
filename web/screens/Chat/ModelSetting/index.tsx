/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams } from '@/utils/model_param'

import settingComponentBuilder from './settingComponentBuilder'

import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const ModelSetting = () => {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  if (!selectedModel || !activeModelParams) return null

  const modelRuntimeParams = toRuntimeParams(activeModelParams)

  const componentData = getConfigurationsData(modelRuntimeParams)

  componentData.sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="flex flex-col">
      {settingComponentBuilder(componentData)}
    </div>
  )
}

export default React.memo(ModelSetting)
