import { memo } from 'react'

import { Badge, Tooltip } from '@janhq/joi'
import { InfoIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

type Props = {
  compact?: boolean
  unit: string
}

const NotEnoughMemoryLabel = ({ unit, compact }: Props) => (
  <Badge
    theme="destructive"
    variant="soft"
    className={twMerge(compact && 'h-5 p-2')}
  >
    {!compact && <span>Not enough {unit}</span>}
    <Tooltip
      trigger={
        compact ? (
          <div className="h-2 w-2 cursor-pointer rounded-full bg-[hsla(var(--destructive-bg))]" />
        ) : (
          <InfoIcon size={14} className="ml-2 cursor-pointer" />
        )
      }
      content="This tag signals insufficient RAM for optimal model performance. It's dynamic and may change with your system's RAM availability."
    />
  </Badge>
)

export default memo(NotEnoughMemoryLabel)
