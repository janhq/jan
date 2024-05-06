import { memo } from 'react'

import { Badge, Tooltip } from '@janhq/joi'
import { InfoIcon } from 'lucide-react'

const NotEnoughMemoryLabel = ({ unit }: { unit: string }) => (
  <Badge theme="destructive" variant="soft">
    <span>Not enough {unit}</span>
    <Tooltip
      trigger={<InfoIcon size={14} className="ml-2" />}
      content="This tag signals insufficient RAM for optimal model performance. It's dynamic and may change with your system's RAM availability."
    />
  </Badge>
)

export default memo(NotEnoughMemoryLabel)
