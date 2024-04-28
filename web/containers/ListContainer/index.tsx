import { ReactNode, useEffect, useRef } from 'react'

import { twMerge } from 'tailwind-merge'

type Props = {
  children: ReactNode
  className?: string
}

const ListContainer: React.FC<Props> = ({ children, className = '' }) => {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scrollHeight = listRef.current?.scrollHeight ?? 0

    listRef.current?.scrollTo({
      top: scrollHeight,
      behavior: 'instant',
    })
  })

  return (
    <div
      ref={listRef}
      className={twMerge(
        'flex h-full w-full flex-col overflow-y-scroll',
        className
      )}
    >
      {children}
    </div>
  )
}

export default ListContainer
