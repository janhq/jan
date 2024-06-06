import React from 'react'

import { twMerge } from 'tailwind-merge'

type Props = {
  description: string
  maxHeight: number
}

const ModelInformation: React.FC<Props> = ({ description, maxHeight }) => {
  // TODO: Add more styling or using another markdown lib
  return (
    <div
      style={{ maxHeight }}
      className={twMerge(
        'text-[hsla(var(--text-secondary)] mt-4 h-full w-full overflow-x-hidden text-sm leading-[16.94px]'
      )}
      dangerouslySetInnerHTML={{
        __html: description,
      }}
    />
  )
}

export default React.memo(ModelInformation)
