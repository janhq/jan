import { useState } from 'react'

import { Slider, Input, Tooltip } from '@janhq/joi'

import { InfoIcon } from 'lucide-react'

import { useClickOutside } from '@/hooks/useClickOutside'

type Props = {
  name: string
  title: string
  disabled: boolean
  description: string
  min: number
  max: number
  step: number
  value: number
  onValueChanged: (e: string | number | boolean) => void
}

const SliderRightPanel = ({
  title,
  disabled,
  min,
  max,
  step,
  description,
  value,
  onValueChanged,
}: Props) => {
  const [showTooltip, setShowTooltip] = useState({ max: false, min: false })

  useClickOutside(() => setShowTooltip({ max: false, min: false }), null, [])
  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-x-2">
        <p className="text-sm font-medium">{title}</p>
        <Tooltip
          trigger={
            <InfoIcon
              size={16}
              className="flex-shrink-0 text-[hsl(var(--app-icon))]"
            />
          }
          content={description}
        />
      </div>
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            value={[value]}
            onValueChange={(e) => onValueChanged?.(e[0])}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
          />
          <div className="relative mt-1 flex items-center justify-between text-[hsla(var(--app-text-secondary))]">
            <p className="text-xs">{min}</p>
            <p className="text-xs">{max}</p>
          </div>
        </div>
        <Tooltip
          open={showTooltip.max || showTooltip.min}
          trigger={
            <Input
              type="number"
              className="-mt-4 h-8 w-14"
              min={min}
              max={max}
              value={String(value)}
              disabled={disabled}
              textAlign="right"
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
          }
          content={
            <>
              {showTooltip.max && (
                <span>Automatically set to the maximum allowed tokens</span>
              )}
              {showTooltip.min && (
                <span>Automatically set to the minimum allowed tokens</span>
              )}
            </>
          }
        />
      </div>
    </div>
  )
}

export default SliderRightPanel
