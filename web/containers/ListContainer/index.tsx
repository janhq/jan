import { ReactNode, useCallback, useEffect, useRef } from 'react'

type Props = {
  children: ReactNode
}

const ListContainer = ({ children }: Props) => {
  const listRef = useRef<HTMLDivElement>(null)
  const prevScrollTop = useRef(0)
  const isUserManuallyScrollingUp = useRef(false)

  const handleScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const currentScrollTop = event.currentTarget.scrollTop

    if (prevScrollTop.current > currentScrollTop) {
      console.debug('User is manually scrolling up')
      isUserManuallyScrollingUp.current = true
    } else {
      const currentScrollTop = event.currentTarget.scrollTop
      const scrollHeight = event.currentTarget.scrollHeight
      const clientHeight = event.currentTarget.clientHeight

      if (currentScrollTop + clientHeight >= scrollHeight) {
        console.debug('Scrolled to the bottom')
        isUserManuallyScrollingUp.current = false
      }
    }

    prevScrollTop.current = currentScrollTop
  }, [])

  useEffect(() => {
    if (isUserManuallyScrollingUp.current === true) return

    const scrollHeight = listRef.current?.scrollHeight ?? 0
    listRef.current?.scrollTo({
      top: scrollHeight,
      behavior: 'instant',
    })
  }, [listRef.current?.scrollHeight, isUserManuallyScrollingUp])

  return (
    <div
      ref={listRef}
      className="flex h-full w-full flex-col overflow-y-scroll"
      onScroll={handleScroll}
    >
      {children}
    </div>
  )
}

export default ListContainer
