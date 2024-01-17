import React from 'react'

import { Badge } from '@janhq/uikit'

const RecommendedLabel: React.FC = () => (
  <Badge className="space-x-1 rounded-md" themes="success">
    <span>Recommended</span>
  </Badge>
)

export default React.memo(RecommendedLabel)
