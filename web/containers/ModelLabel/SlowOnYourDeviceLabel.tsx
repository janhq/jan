import { Fragment, memo } from 'react'

import { Badge, Tooltip } from '@janhq/joi'

import { AlertTriangleIcon, InfoIcon } from 'lucide-react'

type Props = {
  compact?: boolean
}

const tooltipContent = `Your device may be running low on available RAM, which can affect the speed of this model. Try closing any unnecessary applications to free up system memory.`

const SlowOnYourDeviceLabel = ({ compact }: Props) => (
  <>
    {compact ? (
      <div className="flex h-5 w-5 items-center">
        <Tooltip
          trigger={
            <AlertTriangleIcon
              size={14}
              className="cursor-pointer text-[hsla(var(--warning-bg))]"
            />
          }
          content={
            <Fragment>
              <b>Slow on your device:</b> <span>{tooltipContent}</span>
            </Fragment>
          }
        />
      </div>
    ) : (
      <Badge theme="warning" variant="soft">
        <span className="line-clamp-1">Slow on your device</span>
        <Tooltip
          trigger={
            <InfoIcon size={14} className="ml-2 flex-shrink-0 cursor-pointer" />
          }
          content={
            <Fragment>
              <b>Slow on your device:</b> <span>{tooltipContent}</span>
            </Fragment>
          }
        />
      </Badge>
    )}
  </>
)

export default memo(SlowOnYourDeviceLabel)
