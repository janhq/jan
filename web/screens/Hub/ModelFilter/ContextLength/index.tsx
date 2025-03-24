import { useState } from 'react'

import { Slider, Input, Tooltip } from '@janhq/joi'

import { atom, useAtom } from 'jotai'
import { InfoIcon } from 'lucide-react'

export const hubCtxLenAtom = atom(0)

export default function ContextLengthFilter() {
  const [value, setValue] = useAtom(hubCtxLenAtom)
  const [inputingValue, setInputingValue] = useState(false)

  const normalizeTextValue = (value: number) => {
    return value === 100 ? '1M' : value === 0 ? 0 : `${value}K`
  }

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-x-2">
        <p className="font-semibold">Context length</p>
        <Tooltip
          trigger={
            <InfoIcon
              size={16}
              className="flex-shrink-0 text-[hsl(var(--text-secondary))]"
            />
          }
          content="Controls how much text the model can consider at once. Longer context allows the model to handle more input but uses more memory and runs slower."
        />
      </div>
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            value={[value]}
            onValueChange={(e) => {
              setValue(Number(e[0]))
            }}
            min={0}
            max={100}
            step={1}
          />
          <div className="relative mt-1 flex items-center justify-between text-[hsla(var(--text-secondary))]">
            <p className="text-xs">0</p>
            <p className="text-xs">1M</p>
          </div>
        </div>

        <Input
          type="text"
          className="-mt-4 h-8 w-[60px] p-2"
          min={0}
          max={100}
          value={inputingValue ? value : normalizeTextValue(value)}
          textAlign="left"
          onFocus={() => setInputingValue(true)}
          onBlur={(e) => {
            setInputingValue(false)
            const numericValue = e.target.value.replace(/\D/g, '')
            const value = Number(numericValue)
            setValue(value > 100 ? 100 : value)
          }}
          onChange={(e) => {
            // Passthru since it validates again onBlur
            if (/^\d*\.?\d*$/.test(e.target.value)) {
              setValue(Number(e.target.value))
            }

            // Should not accept invalid value or NaN
            // E.g. anything changes that trigger onValueChanged
            // Which is incorrect
            if (
              Number(e.target.value) > 100 ||
              Number(e.target.value) < 0 ||
              Number.isNaN(Number(e.target.value))
            )
              return
            setValue(Number(e.target.value))
          }}
        />
      </div>
    </div>
  )
}
