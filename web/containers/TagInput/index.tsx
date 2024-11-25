import { useState } from 'react'

import { Badge, Input, Tooltip } from '@janhq/joi'

import { InfoIcon, XIcon } from 'lucide-react'

type Props = {
  title: string
  disabled?: boolean
  name: string
  description: string
  placeholder: string
  value: string[]
  onValueChanged?: (e: string | number | boolean | string[]) => void
}

const TagInput = ({
  title,
  disabled = false,
  value,
  description,
  placeholder,
  onValueChanged,
}: Props) => {
  const [pendingDataPoint, setPendingDataPoint] = useState('')

  const addPendingDataPoint = () => {
    if (pendingDataPoint) {
      const newDataPoints = new Set([...value, pendingDataPoint])
      onValueChanged && onValueChanged(Array.from(newDataPoints))
      setPendingDataPoint('')
    }
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-x-2">
        <p className="font-medium">{title}</p>
        <Tooltip
          trigger={
            <InfoIcon
              size={16}
              className="flex-shrink-0 text-[hsla(var(--text-secondary))]"
            />
          }
          content={description}
        />
      </div>
      <Input
        value={pendingDataPoint}
        disabled={disabled}
        onChange={(e) => setPendingDataPoint(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            addPendingDataPoint()
          }
        }}
      />
      <div className="mt-2 flex min-h-[2.5rem] flex-wrap items-center gap-2 overflow-y-auto">
        {value.map((item, idx) => (
          <Badge key={idx} theme="secondary">
            {item}
            <button
              type="button"
              className="ml-1.5 w-3 bg-transparent"
              onClick={() => {
                onValueChanged &&
                  onValueChanged(value.filter((i) => i !== item))
              }}
            >
              <XIcon className="w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  )
}

export default TagInput
