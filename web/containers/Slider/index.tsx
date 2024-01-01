import React from 'react'

import { Slider, Input, TooltipPortal } from '@janhq/uikit'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
} from '@janhq/uikit'
import { useAtomValue } from 'jotai'
import { InfoIcon } from 'lucide-react'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  description: string
  title: string
  min: number
  max: number
  step: number
  value: number
}

const SliderRightPanel: React.FC<Props> = ({
  name,
  title,
  min,
  max,
  description,
  step,
  value,
}) => {
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)

  const onValueChanged = (e: number[]) => {
    if (!threadId) return
    updateModelParameter(threadId, name, e[0])
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-x-2">
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
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            value={[value]}
            onValueChange={onValueChanged}
            min={min}
            max={max}
            step={step}
          />
          <div className="relative mt-2 flex items-center justify-between text-gray-400">
            <p className="text-sm">{min}</p>
            <p className="absolute left-1/2 -translate-x-1/2 text-sm">
              {max / 2}
            </p>
            <p className="text-sm">{max}</p>
          </div>
        </div>
        <Input
          className="-mt-4 h-8 w-16"
          min={min}
          max={max}
          value={String(value)}
          onChange={(e) => onValueChanged([Number(e.target.value)])}
        />
      </div>
    </div>
  )
}

export default SliderRightPanel
