import { Fragment, memo } from 'react'

import { Badge, Tooltip } from '@janhq/joi'
import { AlertTriangleIcon, InfoIcon } from 'lucide-react'

type Props = {
  compact?: boolean
  unit: string
}

const tooltipContent = `Your device doesn't have enough RAM to run this model. Consider upgrading your RAM or using a device with more memory capacity.`

const NotEnoughMemoryLabel = ({ unit, compact }: Props) => (
  <>
    {compact ? (
      <div className="flex h-5 w-5 items-center">
        <Tooltip
          trigger={
            <AlertTriangleIcon
              size={14}
              className="cursor-pointer text-[hsla(var(--destructive-bg))]"
            />
          }
          content={
            <Fragment>
              <b>Not enough RAM:</b> <span>{tooltipContent}</span>
            </Fragment>
          }
        />
      </div>
    ) : (
      <Badge theme="destructive" variant="soft">
        <span className="line-clamp-1">Not enough {unit}</span>
        <Tooltip
          trigger={
            <InfoIcon size={14} className="ml-2 flex-shrink-0 cursor-pointer" />
          }
          content={
            <Fragment>
              <b>Not enough RAM:</b> <span>{tooltipContent}</span>
            </Fragment>
          }
        />
      </Badge>
    )}
  </>
)

export default memo(NotEnoughMemoryLabel)
