import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ThreadMessage } from '@janhq/core'
import { ScrollArea } from '@janhq/joi'
import { useVirtualizer } from '@tanstack/react-virtual'

import { useAtomValue } from 'jotai'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import ChatItem from '../ChatItem'

import LoadModelError from '../LoadModelError'

import EmptyThread from './EmptyThread'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'
import {
  activeThreadAtom,
  isBlockingSendAtom,
} from '@/helpers/atoms/Thread.atom'

const ChatConfigurator = memo(() => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const currentThread = useAtomValue(activeThreadAtom)

  const [current, setCurrent] = useState<ThreadMessage[]>([])
  const loadModelError = useAtomValue(loadModelErrorAtom)

  const isMessagesIdentificial = (
    arr1: ThreadMessage[],
    arr2: ThreadMessage[]
  ): boolean => {
    if (arr1.length !== arr2.length) return false
    return arr1.every((item, index) => item.id === arr2[index].id)
  }

  useEffect(() => {
    if (
      !isMessagesIdentificial(messages, current) ||
      messages.some((e) => e.thread_id !== currentThread?.id)
    ) {
      setCurrent(messages)
    }
  }, [messages, current, loadModelError, currentThread])

  if (!messages.length) return <EmptyThread />
  return (
    <div className="flex h-full w-full flex-col">
      <ChatBody loadModelError={loadModelError} messages={current} />
    </div>
  )
})

const ChatBody = memo(
  ({
    messages,
    loadModelError,
  }: {
    messages: ThreadMessage[]
    loadModelError?: string
  }) => {
    // The scrollable element for your list
    const parentRef = useRef<HTMLDivElement>(null)
    const prevScrollTop = useRef(0)
    const isUserManuallyScrollingUp = useRef(false)
    const currentThread = useAtomValue(activeThreadAtom)
    const isBlockingSend = useAtomValue(isBlockingSendAtom)
    const showScrollBar = useAtomValue(showScrollBarAtom)

    const count = useMemo(
      () => (messages?.length ?? 0) + (loadModelError ? 1 : 0),
      [messages, loadModelError]
    )

    // The virtualizer
    const virtualizer = useVirtualizer({
      count,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 35,
      overscan: 5,
    })

    useEffect(() => {
      isUserManuallyScrollingUp.current = false
      if (parentRef.current && isBlockingSend) {
        parentRef.current.scrollTo({ top: parentRef.current.scrollHeight })
        virtualizer.scrollToIndex(count - 1)
      }
    }, [count, virtualizer, isBlockingSend, currentThread?.id])

    const items = virtualizer.getVirtualItems()

    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _,
      instance
    ) => {
      if (isUserManuallyScrollingUp.current === true && isBlockingSend)
        return false
      return (
        // item.start < (instance.scrollOffset ?? 0) &&
        instance.scrollDirection !== 'backward'
      )
    }

    const handleScroll = useCallback(
      (event: React.UIEvent<HTMLElement>) => {
        const currentScrollTop = event.currentTarget.scrollTop

        if (prevScrollTop.current > currentScrollTop && isBlockingSend) {
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
      },
      [isBlockingSend]
    )

    return (
      <div className="flex h-full w-full flex-col overflow-x-hidden">
        <ScrollArea
          type={showScrollBar ? 'always' : 'scroll'}
          ref={parentRef}
          onScroll={handleScroll}
          className="List"
          style={{
            flex: 1,
            height: '100%',
            width: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            contain: 'strict',
          }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${items[0]?.start ?? 0}px)`,
              }}
            >
              {items.map((virtualRow) => (
                <div
                  key={messages[virtualRow.index]?.id ?? virtualRow.index}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="first:mt-4"
                >
                  {loadModelError && virtualRow.index === count - 1 ? (
                    <LoadModelError />
                  ) : (
                    <ChatItem
                      {...messages[virtualRow.index]}
                      loadModelError={loadModelError}
                      index={virtualRow.index}
                      isCurrentMessage={
                        virtualRow.index === messages?.length - 1
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>
    )
  }
)

export default memo(ChatConfigurator)
