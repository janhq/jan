import React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import './styles.scss'

type Props = {
  name?: string
  min?: number
  max?: number
  onValueChange?(value: number[]): void
  value?: number[]
  defaultValue?: number[]
  step?: number
  disabled?: boolean
}

const Slider = ({
  name,
  min,
  max,
  onValueChange,
  value,
  defaultValue,
  step,
  disabled,
}: Props) => (
  <SliderPrimitive.Root
    className="slider"
    name={name}
    min={min}
    max={max}
    onValueChange={onValueChange}
    value={value}
    defaultValue={defaultValue}
    step={step}
    disabled={disabled}
  >
    <SliderPrimitive.Track className="slider__track">
      <SliderPrimitive.Range className="slider__range" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="slider__thumb" />
  </SliderPrimitive.Root>
)

export { Slider }
