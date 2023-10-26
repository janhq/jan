import { formatTwoDigits } from '@utils/converter'
import React from 'react'
import { Controller, useController } from 'react-hook-form'

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
          <span className="rounded-md border border-border px-2 py-1 text-accent">
            {formatTwoDigits(value)}
          </span>
        )}
      />
    </div>
  )
}

export default DraggableProgressBar
