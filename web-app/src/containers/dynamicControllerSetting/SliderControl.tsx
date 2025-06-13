import * as React from 'react'
import { SliderProps } from '@radix-ui/react-slider'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'

interface SliderControlProps {
  key?: string
  title?: string
  description?: string
  value?: SliderProps['defaultValue']
  min?: number
  max?: number
  step?: number
  id?: string
  onChange?: (value: SliderProps['defaultValue']) => void
}

export function SliderControl({
  value,
  key,
  title,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: SliderControlProps) {
  const [currentValue, setCurrentValue] = React.useState<number[]>(
    Array.isArray(value) ? value : [min]
  )
  const [inputValue, setInputValue] = React.useState<string>(
    currentValue[0].toString()
  )
  const [inputNumber, setInputNumber] = React.useState<number>(currentValue[0])
  const isExceedingMax = inputNumber > max

  const handleValueChange = (newValue: SliderProps['defaultValue']) => {
    if (newValue) {
      setCurrentValue(newValue)
      setInputValue(newValue[0].toString())
      setInputNumber(newValue[0])
      onChange?.(newValue)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)

    const newValue = parseFloat(value)
    if (!isNaN(newValue)) {
      setInputNumber(newValue)
      if (newValue >= min && newValue <= max) {
        handleValueChange([newValue])
      }
    }
  }

  return (
    <div className="grid gap-2 pt-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <div className="w-full space-y-2">
            <Slider
              id={key}
              min={min}
              max={max}
              step={step}
              value={currentValue}
              onValueChange={handleValueChange}
              className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
              aria-label={title}
            />
            <div className="flex justify-between px-1">
              <span className="text-xs text-main-view-fg/50">{min}</span>
              <span className="text-xs text-main-view-fg/50">{max}</span>
            </div>
          </div>
          <Input
            className={`w-16 h-8 -mt-6 rounded-md border px-2 text-right text-xs ${
              isExceedingMax
                ? 'border-destructive text-destructive'
                : 'text-main-view-fg/20 border-main-view-fg/10'
            } transition-all duration-200 ease-in-out`}
            value={inputValue}
            onChange={handleInputChange}
          />
        </div>
      </div>
      {isExceedingMax && (
        <p className="text-xs text-destructive">
          Maximum value allowed is <span className="font-medium">{max}</span>
        </p>
      )}
    </div>
  )
}
