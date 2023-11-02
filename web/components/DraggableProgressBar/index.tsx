/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { Controller, useController } from 'react-hook-form'

import { formatTwoDigits } from '@/utils/converter'

type Props = {
  id: string
  control: any
  min: number
  max: number
  step: number
}

const DraggableProgressBar: React.FC<Props> = ({
  id,
  control,
  min,
  max,
  step,
}) => {
  const { field } = useController({
    name: id,
    control: control,
  })

  return (
    <div className="flex items-center gap-2">
      <input
        {...field}
        className="flex-1"
        type="range"
        min={min}
        max={max}
        step={step}
      />
      <Controller
        name={id}
        control={control}
        render={({ field: { value } }) => (
          <span className="border-border text-accent rounded-md border px-2 py-1">
            {formatTwoDigits(value)}
          </span>
        )}
      />
    </div>
  )
}

export default DraggableProgressBar
