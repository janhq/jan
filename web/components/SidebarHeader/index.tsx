import React from 'react'

import Image from 'next/image'

const SidebarHeader: React.FC = () => (
  <div className="flex flex-col gap-2.5 px-3">
    <Image src={'icons/Jan_AppIcon.svg'} width={68} height={28} alt="" />
  </div>
)

export default React.memo(SidebarHeader)
