import React from 'react'
import { TagType } from './TagType'
import { tagStyleMapper } from './TagStyleMapper'

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
        className={`line-clamp-1 max-w-[40%] items-center rounded px-2.5 py-0.5 text-xs font-medium ${tagStyleMapper[type]}`}
      >
        {title}
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`line-clamp-1 max-w-[40%] items-center rounded px-2.5 py-0.5 text-xs font-medium ${tagStyleMapper[type]}`}
    >
      {title} x
    </button>
  )
}

export default React.memo(SimpleTag)
