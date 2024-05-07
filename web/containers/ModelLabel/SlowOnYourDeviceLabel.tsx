import { memo } from 'react'

import { Badge, Tooltip } from '@janhq/joi'

import { InfoIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

type Props = {
  compact?: boolean
}

const SlowOnYourDeviceLabel = ({ compact }: Props) => (
  <Badge
    theme="warning"
    variant="soft"
    className={twMerge(compact && 'h-5 p-2')}
  >
    {!compact && <span>Slow on your device</span>}
    <Tooltip
      trigger={
        compact ? (
          <div className="h-2 w-2 cursor-pointer rounded-full bg-[hsla(var(--warning-bg))]" />
        ) : (
          <InfoIcon size={14} className="ml-2 cursor-pointer" />
        )
      }
      content="This tag indicates that your current RAM performance may affect model speed. It can change based on other active apps. To improve, consider closing unnecessary applications to free up RAM."
    />
  </Badge>
)

export default memo(SlowOnYourDeviceLabel)
