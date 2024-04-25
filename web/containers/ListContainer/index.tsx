import { ReactNode, useEffect, useRef } from 'react'

type Props = {
  children: ReactNode
}

const ListContainer: React.FC<Props> = ({ children }) => {
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
      className="flex h-full w-full flex-col overflow-y-scroll"
    >
      {children}
    </div>
  )
}

export default ListContainer
