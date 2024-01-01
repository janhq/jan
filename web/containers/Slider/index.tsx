/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

import { Slider, Input, TooltipPortal } from '@janhq/uikit'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
} from '@janhq/uikit'
// import { useAtomValue } from 'jotai'
import { InfoIcon } from 'lucide-react'

// import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

// import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  description: string
  title: string
  min: number
  max: number
  step: number
  value: number[]
  onChange: (e: any) => void
  onBlur: (e: any) => void
}

const SliderRightPanel: React.FC<Props> = ({
  name,
  title,
  min,
  max,
  description,
  onChange,
  onBlur,
  step,
  value,
}) => {
  // const { updateModelParameter } = useUpdateModelParameters()
  // const threadId = useAtomValue(getActiveThreadIdAtom)

  // const onValueChanged = (e: number[]) => {
  //   if (!threadId) return
  //   updateModelParameter(threadId, name, e[0])
  // }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-x-2">
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
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            defaultValue={value}
            onValueChange={(e) => onChange(e[0])}
            onChange={(e) => onChange(e)}
            onBlur={onBlur}
            name={name}
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
          name={name}
          value={value[0] || String(value[0])}
          onChange={(e) => onChange([e.target.value])}
          onBlur={onBlur}
        />
      </div>
    </div>
  )
}

export default SliderRightPanel
