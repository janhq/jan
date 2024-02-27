import React, { useState } from 'react'

import {
  Slider,
  Input,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { InfoIcon } from 'lucide-react'

import { useClickOutside } from '@/hooks/useClickOutside'

type Props = {
  name: string
  title: string
  enabled: boolean
  description: string
  min: number
  max: number
  step: number
  value: number
  onValueChanged: (e: string | number | boolean) => void
}

const SliderRightPanel: React.FC<Props> = ({
  title,
  enabled,
  min,
  max,
  step,
  description,
  value,
  onValueChanged,
}) => {
  const [showTooltip, setShowTooltip] = useState({ max: false, min: false })

  useClickOutside(() => setShowTooltip({ max: false, min: false }), null, [])
  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-x-2">
        <p className="text-sm font-semibold text-zinc-500">{title}</p>
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
            onValueChange={(e) => onValueChanged?.(e[0])}
            min={min}
            max={max}
            step={step}
            disabled={!enabled}
          />
          <div className="relative mt-2 flex items-center justify-between text-gray-400">
            <p className="text-sm">{min}</p>
            <p className="text-sm">{max}</p>
          </div>
        </div>
        <Tooltip open={showTooltip.max || showTooltip.min}>
          <TooltipTrigger asChild>
            <Input
              type="number"
              className="-mt-4 h-8 w-20"
              min={min}
              max={max}
              value={String(value)}
              disabled={!enabled}
              onBlur={(e) => {
                if (Number(e.target.value) > Number(max)) {
                  onValueChanged?.(Number(max))
                  setShowTooltip({ max: true, min: false })
                } else if (Number(e.target.value) < Number(min)) {
                  onValueChanged?.(Number(min))
                  setShowTooltip({ max: false, min: true })
                }
              }}
              onChange={(e) => {
                onValueChanged?.(Number(e.target.value))
              }}
            />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent className="max-w-[240px]" side="top">
              {showTooltip.max && (
                <span>Automatically set to the maximum allowed tokens</span>
              )}
              {showTooltip.min && (
                <span>Automatically set to the minimum allowed tokens</span>
              )}
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>
    </div>
  )
}

export default SliderRightPanel
