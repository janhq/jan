import { memo } from 'react'

import { Badge, Tooltip } from '@janhq/joi'
import { InfoIcon } from 'lucide-react'

const SlowOnYourDeviceLabel = () => (
  <Badge theme="warning" variant="soft">
    <span>Slow on your device</span>
    <Tooltip
      trigger={<InfoIcon size={14} className="ml-2" />}
      content="This tag indicates that your current RAM performance may affect model speed. It can change based on other active apps. To improve, consider closing unnecessary applications to free up RAM."
    />
  </Badge>
)

export default memo(SlowOnYourDeviceLabel)
