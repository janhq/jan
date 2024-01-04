import React from 'react'

import {
  Switch,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { useAtomValue, useSetAtom } from 'jotai'
import { InfoIcon } from 'lucide-react'

import { useActiveModel } from '@/hooks/useActiveModel'
import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toSettingParams } from '@/utils/model_param'

import {
  engineParamsUpdateAtom,
  getActiveThreadIdAtom,
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  title: string
  description: string
  checked: boolean
}

const Checkbox: React.FC<Props> = ({ name, title, checked, description }) => {
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)

  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)

  const modelSettingParams = toSettingParams(activeModelParams)

  const engineParams = getConfigurationsData(modelSettingParams)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)

  const { stopModel } = useActiveModel()

  const onCheckedChange = (checked: boolean) => {
    if (!threadId) return
    if (engineParams.some((x) => x.name.includes(name))) {
      setEngineParamsUpdate(true)
      stopModel()
    } else {
      setEngineParamsUpdate(false)
    }
    updateModelParameter(threadId, name, checked)
  }

  return (
    <div className="flex justify-between">
      <div className="mb-1 flex items-center gap-x-2">
        <p className="text-sm font-semibold text-zinc-500 dark:text-gray-300">
          {title}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon size={16} className="flex-shrink-0 dark:text-gray-500" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="top" className="max-w-[240px]">
              <span>{description}</span>
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default Checkbox
