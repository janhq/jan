import { useState } from 'react'

import { Slider, Input, Tooltip } from '@janhq/joi'

import { useClickOutside } from '@janhq/joi'
import { InfoIcon } from 'lucide-react'

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
  const [val, setVal] = useState(value.toString())

  useClickOutside(() => setShowTooltip({ max: false, min: false }), null, [])

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-x-2">
        <p className="font-medium">{title}</p>
        <Tooltip
          trigger={
            <InfoIcon
              size={16}
              className="flex-shrink-0 text-[hsl(var(--text-secondary))]"
            />
          }
          content={description}
        />
      </div>
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            value={[value]}
            onValueChange={(e) => {
              onValueChanged?.(e[0])
              setVal(e[0].toString())
            }}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
          />
          <div className="relative mt-1 flex items-center justify-between text-[hsla(var(--text-secondary))]">
            <p className="text-xs">{min}</p>
            <p className="text-xs">{max}</p>
          </div>
        </div>
        <Tooltip
          open={showTooltip.max || showTooltip.min}
          trigger={
            <Input
              type="text"
              className="-mt-4 h-8 w-[60px]"
              min={min}
              max={max}
              value={val}
              disabled={disabled}
              textAlign="right"
              onBlur={(e) => {
                if (Number(e.target.value) > Number(max)) {
                  onValueChanged?.(Number(max))
                  setVal(max.toString())
                  setShowTooltip({ max: true, min: false })
                } else if (Number(e.target.value) < Number(min)) {
                  onValueChanged?.(Number(min))
                  setVal(min.toString())
                  setShowTooltip({ max: false, min: true })
                }
              }}
              onChange={(e) => {
                onValueChanged?.(e.target.value)
                if (/^\d*\.?\d*$/.test(e.target.value)) {
                  setVal(e.target.value)
                }
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
