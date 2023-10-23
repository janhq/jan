import { formatTwoDigits } from '@utils/converter'
import React from 'react'

type Props = {
  title: string
  value: number
  min: number
  max: number
  step: number
  onValueChanged: (value: number) => void
}

const ProgressSetting: React.FC<Props> = ({
  title,
  value,
  min,
  max,
  step,
  onValueChanged,
}) => (
  <div className="flex w-full flex-col">
    <p>{title}</p>
    <div className="mt-2 flex items-center gap-2">
      <input
        className="flex-1"
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          onValueChanged(Number(e.target.value))
        }}
      />
      <span className="rounded-md border border-[#737d7d] px-2 py-1 text-gray-900">
        {formatTwoDigits(value)}
      </span>
    </div>
  </div>
)

export default ProgressSetting
