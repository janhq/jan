import { Switch, Tooltip } from '@janhq/joi'

import { InfoIcon } from 'lucide-react'

type Props = {
  name: string
  title: string
  disabled?: boolean
  description: string
  checked: boolean
  onValueChanged?: (e: string | number | boolean) => void
}

const Checkbox = ({
  title,
  checked,
  disabled = false,
  description,
  onValueChanged,
}: Props) => {
  const onCheckedChange = (checked: boolean) => {
    onValueChanged?.(checked)
  }

  return (
    <div className="flex justify-between">
      <div className="mb-1 flex items-center gap-x-2">
        <p className="font-semibold">{title}</p>
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
      <Switch
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        disabled={disabled}
      />
    </div>
  )
}

export default Checkbox
