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
  warnAbove?: number
  warnBelow?: number
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
  warnAbove,
  warnBelow,
  onChange,
}: SliderControlProps) {
  const initialValue =
    Array.isArray(value) && value[0] !== undefined ? value : [min]
  const [currentValue, setCurrentValue] = React.useState<number[]>(initialValue)
  const [inputValue, setInputValue] = React.useState<string>(
    initialValue[0].toString()
  )
  const [inputNumber, setInputNumber] = React.useState<number>(initialValue[0])
  const isExceedingMax = inputNumber > max
  const isInWarnBand =
    (warnAbove !== undefined && inputNumber > warnAbove) ||
    (warnBelow !== undefined && inputNumber < warnBelow)

  React.useEffect(() => {
    if (Array.isArray(value) && value[0] !== undefined) {
      setCurrentValue(value)
      setInputValue(value[0].toString())
      setInputNumber(value[0])
    }
  }, [value])

  const handleValueChange = (newValue: SliderProps['defaultValue']) => {
    if (newValue) {
      setCurrentValue(newValue)
      setInputValue(newValue[0].toString())
      setInputNumber(newValue[0])
      onChange?.(newValue)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setInputValue(v)
    const parsed = parseFloat(v)
    if (!isNaN(parsed)) {
      setInputNumber(parsed)
      if (parsed >= min && parsed <= max) {
        handleValueChange([parsed])
      }
    }
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {min}
          </span>
          <Slider
            id={key}
            min={min}
            max={max}
            step={step}
            value={currentValue}
            onValueChange={handleValueChange}
            className={`flex-1 **:[[role=slider]]:h-4 **:[[role=slider]]:w-4 ${
              isInWarnBand
                ? '**:[[data-slot=slider-range]]:bg-amber-500'
                : ''
            }`}
            aria-label={title}
          />
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {max}
          </span>
        </div>
        <Input
          className={`w-16 h-7 shrink-0 rounded-md border px-2 text-right text-xs tabular-nums ${
            isExceedingMax
              ? 'border-destructive text-destructive'
              : 'text-foreground'
          }`}
          value={inputValue}
          onChange={handleInputChange}
        />
      </div>
      {isExceedingMax && (
        <p className="text-xs text-destructive mt-1">
          Maximum value allowed is <span className="font-medium">{max}</span>
        </p>
      )}
    </div>
  )
}
