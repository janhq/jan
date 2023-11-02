import React from 'react'

import { tagStyleMapper } from './TagStyleMapper'
import { TagType } from './TagType'

type Props = {
  title: string
  type: TagType
  clickable?: boolean
  onClick?: () => void
}

const SimpleTag: React.FC<Props> = ({
  onClick,
  clickable = true,
  title,
  type,
}) => {
  if (!title || title.length === 0) return null
  if (!clickable) {
    return (
      <div
        className={`line-clamp-1 max-w-[70%] items-center rounded-full px-2 py-0.5 text-xs dark:bg-opacity-10 ${tagStyleMapper[type]}`}
      >
        {title}
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`line-clamp-1 max-w-[70%] items-center rounded-full px-2 py-0.5 text-xs dark:bg-opacity-10 ${tagStyleMapper[type]}`}
    >
      {title} x
    </button>
  )
}

export default React.memo(SimpleTag)
