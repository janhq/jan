import { formatTwoDigits } from '@/_utils/converter'
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
    <div className="mt-2 flex items-center gap-2">
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
          <span className="rounded-md border border-[#737d7d] px-2 py-1 text-gray-900">
            {formatTwoDigits(value)}
          </span>
        )}
      />
    </div>
  )
}

export default DraggableProgressBar
