import React from 'react'

import {
  Badge,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'
import { InfoIcon } from 'lucide-react'

const SlowOnYourDeviceLabel: React.FC = () => (
  <Badge className="space-x-1 rounded-md" themes="warning">
    <span>Slow on your device</span>
    <Tooltip>
      <TooltipTrigger>
        <InfoIcon size={16} />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="right" sideOffset={10} className="max-w-[300px]">
          <span>
            This tag indicates that your current RAM performance may affect
            model speed. It can change based on other active apps. To improve,
            consider closing unnecessary applications to free up RAM.
          </span>
          <TooltipArrow />
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  </Badge>
)

export default React.memo(SlowOnYourDeviceLabel)
