import { useEffect, useRef, useState } from 'react'

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

function TooltipBadge({
  item,
  value,
  onValueChanged,
}: {
  item: string
  value: string[]
  onValueChanged?: (e: string[]) => void
}) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [isEllipsized, setIsEllipsized] = useState(false)

  useEffect(() => {
    if (textRef.current) {
      setIsEllipsized(textRef.current.scrollWidth > textRef.current.clientWidth)
    }
  }, [item])

  return (
    <div className="relative">
      {isEllipsized ? (
        <Tooltip
          trigger={
            <div className="relative">
              <Badge theme="secondary" className="text-ellipsis">
                <span
                  ref={textRef}
                  className="inline-block max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {item}
                </span>
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
            </div>
          }
          content={item}
        />
      ) : (
        <Badge theme="secondary" className="relative">
          <span
            ref={textRef}
            className="max-w-[90px] overflow-hidden text-ellipsis"
          >
            {item}
          </span>
          <button
            type="button"
            className="ml-1.5 w-3 bg-transparent"
            onClick={() => {
              onValueChanged && onValueChanged(value.filter((i) => i !== item))
            }}
          >
            <XIcon className="w-3" />
          </button>
        </Badge>
      )}
    </div>
  )
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
      {value.length > 0 && (
        <div className="relative mt-2 flex min-h-[2.5rem] flex-wrap items-center gap-2">
          {value.map((item, idx) => {
            return (
              <TooltipBadge
                key={idx}
                item={item}
                value={value}
                onValueChanged={onValueChanged}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export default TagInput
