import {
  Textarea,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { InfoIcon } from 'lucide-react'

type Props = {
  title: string
  enabled?: boolean
  name: string
  description: string
  placeholder: string
  value: string
  onValueChanged?: (e: string | number | boolean) => void
}

const ModelConfigInput: React.FC<Props> = ({
  title,
  enabled = true,
  value,
  description,
  placeholder,
  onValueChanged,
}) => {
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-x-2">
        <p className="text-sm font-semibold text-zinc-500">{title}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon size={16} className="flex-shrink-0" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="top" className="max-w-[240px]">
              <span>{description}</span>
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>
      <Textarea
        placeholder={placeholder}
        onChange={(e) => onValueChanged?.(e.target.value)}
        value={value}
        disabled={!enabled}
      />
    </div>
  )
}

export default ModelConfigInput
