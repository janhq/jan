import { memo } from 'react'

import { Badge } from '@janhq/joi'

import { twMerge } from 'tailwind-merge'

type Props = {
  compact?: boolean
}

const RecommendedLabel = ({ compact }: Props) => (
  <Badge
    theme="success"
    variant="soft"
    className={twMerge(compact && 'h-5 w-5 p-1')}
  >
    {!compact && <span>Recommended</span>}
  </Badge>
)

export default memo(RecommendedLabel)
