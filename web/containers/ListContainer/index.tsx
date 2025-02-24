import { PropsWithChildren, useCallback, useEffect, useRef } from 'react'

import { ScrollArea } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const ListContainer = ({ children }: PropsWithChildren) => {
  const listRef = useRef<HTMLDivElement>(null)
  const prevScrollTop = useRef(0)
  const isUserManuallyScrollingUp = useRef(false)
  const activeThread = useAtomValue(activeThreadAtom)
  const prevActiveThread = useRef(activeThread)
  const showScrollBar = useAtomValue(showScrollBarAtom)

  // Handle active thread changes
  useEffect(() => {
    if (prevActiveThread.current?.id !== activeThread?.id) {
      isUserManuallyScrollingUp.current = false
      const scrollHeight = listRef.current?.scrollHeight ?? 0
      listRef.current?.scrollTo({
        top: scrollHeight,
        behavior: 'instant',
      })
      prevActiveThread.current = activeThread // Update the previous active thread reference
    }
  }, [activeThread])

  const handleScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const currentScrollTop = event.currentTarget.scrollTop

    if (prevScrollTop.current > currentScrollTop) {
      isUserManuallyScrollingUp.current = true
    } else {
      const currentScrollTop = event.currentTarget.scrollTop
      const scrollHeight = event.currentTarget.scrollHeight
      const clientHeight = event.currentTarget.clientHeight

      if (currentScrollTop + clientHeight >= scrollHeight) {
        isUserManuallyScrollingUp.current = false
      }
    }

    if (isUserManuallyScrollingUp.current === true) {
      event.preventDefault()
      event.stopPropagation()
    }
    prevScrollTop.current = currentScrollTop
  }, [])

  useEffect(() => {
    if (isUserManuallyScrollingUp.current === true || !listRef.current) return
    const scrollHeight = listRef.current?.scrollHeight ?? 0
    listRef.current?.scrollTo({
      top: scrollHeight,
      behavior: 'instant',
    })
  }, [listRef.current?.scrollHeight, isUserManuallyScrollingUp])

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="flex h-full w-full flex-col overflow-x-hidden"
      ref={listRef}
      onScroll={handleScroll}
    >
      {children}
    </ScrollArea>
  )
}

export default ListContainer
