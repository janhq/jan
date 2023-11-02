import React from 'react'

import { ArrowLeftIcon } from '@heroicons/react/24/outline'

const HeaderBackButton: React.FC = () => {
  return (
    <button className="flex items-center gap-1">
      <ArrowLeftIcon width={24} height={24} />
      <span className="text-sm">Back</span>
    </button>
  )
}

export default React.memo(HeaderBackButton)
