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
  disabled?: boolean
  name: string
  description: string
  placeholder: string
  value: string
  onValueChanged?: (e: string | number | boolean) => void
}

const ModelConfigInput: React.FC<Props> = ({
  title,
  disabled = false,
  value,
  description,
  placeholder,
  onValueChanged,
}) => (
  <div className="flex flex-col">
    <div className="mb-2 flex items-center gap-x-2">
      <p className="text-sm font-semibold text-zinc-500 dark:text-gray-300">
        {title}
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <InfoIcon size={16} className="flex-shrink-0 dark:text-gray-500" />
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
      disabled={disabled}
    />
  </div>
)

export default ModelConfigInput
