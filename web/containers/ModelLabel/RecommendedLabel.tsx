import { memo } from 'react'

import { Badge } from '@janhq/joi'

const RecommendedLabel = () => (
  <Badge theme="success" variant="soft">
    <span>Recommended</span>
  </Badge>
)

export default memo(RecommendedLabel)
