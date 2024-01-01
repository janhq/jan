import React from 'react'

import {
  Switch,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  title: string
  description: string
  checked: boolean
}

const Checkbox: React.FC<Props> = ({ name, title, checked, description }) => {
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)

  const onCheckedChange = (checked: boolean) => {
    if (!threadId) return

    updateModelParameter(threadId, name, checked)
  }

  return (
    <div className="flex justify-between">
      <div className="mb-1 flex items-center gap-x-2">
        <p className="text-sm font-semibold text-gray-600">{title}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon size={16} className="flex-shrink-0" />
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
