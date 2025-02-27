import { useRef, useState } from 'react'

import { Slider, Input, Tooltip } from '@janhq/joi'

import { atom, useAtom } from 'jotai'
import { InfoIcon } from 'lucide-react'

export const hubModelSizeMinAtom = atom(0)
export const hubModelSizeMaxAtom = atom(100)

export default function ModelSizeFilter({ max }: { max: number }) {
  const [value, setValue] = useAtom(hubModelSizeMinAtom)
  const [valueMax, setValueMax] = useAtom(hubModelSizeMaxAtom)
  const [inputingMinValue, setInputingMinValue] = useState(false)
  const [inputingMaxValue, setInputingMaxValue] = useState(false)

  const normalizeTextValue = (value: number) => {
    return value === 0 ? 0 : `${value}GB`
  }

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-x-2">
        <p className="font-semibold">Model size</p>
      </div>
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            value={[value, valueMax]}
            onValueChange={(e) => {
              setValue(Number(e[0]))
              setValueMax(Number(e[1]))
            }}
            min={0}
            max={max}
            step={1}
          />
        </div>
      </div>
      <div className="flex w-full flex-col items-center gap-x-4">
        <div className="relative mt-1 flex w-full items-center justify-between">
          <div>
            <p className="text-xs text-[hsla(var(--text-secondary))]">from</p>

            <Input
              type="text"
              className="mt-1 h-8 w-[60px] p-2"
              min={0}
              max={max}
              value={inputingMinValue ? value : normalizeTextValue(value)}
              textAlign="left"
              onFocus={(e) => setInputingMinValue(true)}
              onBlur={(e) => {
                setInputingMinValue(false)
                const numericValue = e.target.value.replace(/\D/g, '')
                const value = Number(numericValue)
                setValue(value > valueMax ? valueMax : value)
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
                  Number(e.target.value) > max ||
                  Number(e.target.value) < 0 ||
                  Number.isNaN(Number(e.target.value))
                )
                  return
                setValue(Number(e.target.value))
              }}
            />
          </div>
          <div className="">
            <p className="text-xs text-[hsla(var(--text-secondary))]">to</p>

            <Input
              type="text"
              className="mt-1 h-8 w-[60px] p-2"
              min={0}
              max={max}
              value={inputingMaxValue ? valueMax : normalizeTextValue(valueMax)}
              textAlign="left"
              onFocus={(e) => setInputingMaxValue(true)}
              onBlur={(e) => {
                setInputingMaxValue(false)
                const numericValue = e.target.value.replace(/\D/g, '')
                const value = Number(numericValue)
                setValueMax(value > max ? max : value)
              }}
              onChange={(e) => {
                // Passthru since it validates again onBlur
                if (/^\d*\.?\d*$/.test(e.target.value)) {
                  setValueMax(Number(e.target.value))
                }

                // Should not accept invalid value or NaN
                // E.g. anything changes that trigger onValueChanged
                // Which is incorrect
                if (
                  Number(e.target.value) > max ||
                  Number(e.target.value) < 0 ||
                  Number.isNaN(Number(e.target.value))
                )
                  return
                setValueMax(Number(e.target.value))
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
