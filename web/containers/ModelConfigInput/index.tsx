import { TextArea, Tooltip } from '@janhq/joi'

import { InfoIcon } from 'lucide-react'

type Props = {
  title: string
  disabled?: boolean
  name: string
  description: string
  placeholder: string
  value: string
  onValueChanged?: (e: string | number | boolean) => void
}

const ModelConfigInput = ({
  title,
  disabled = false,
  value,
  description,
  placeholder,
  onValueChanged,
}: Props) => {
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
      <TextArea
        placeholder={placeholder}
        onChange={(e) => onValueChanged?.(e.target.value)}
        autoResize
        value={value}
        disabled={disabled}
      />
    </div>
  )
}

export default ModelConfigInput
