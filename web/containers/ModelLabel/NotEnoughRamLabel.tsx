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

const NotEnoughRamLabel: React.FC = () => (
  <Badge className="space-x-1 rounded-md" themes="danger">
    <span>Not enough RAM</span>
    <Tooltip>
      <TooltipTrigger>
        <InfoIcon size={16} />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="right" sideOffset={10} className="max-w-[300px]">
          <span>
            {`This tag signals insufficient RAM for optimal model
              performance. It's dynamic and may change with your system's
              RAM availability.`}
          </span>
          <TooltipArrow />
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  </Badge>
)

export default React.memo(NotEnoughRamLabel)
