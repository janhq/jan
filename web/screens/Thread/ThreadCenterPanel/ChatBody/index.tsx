import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { ThreadMessage } from '@janhq/core'
import { useVirtualizer } from '@tanstack/react-virtual'

import { useAtomValue } from 'jotai'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import ChatItem from '../ChatItem'

import LoadModelError from '../LoadModelError'

import EmptyThread from './EmptyThread'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatConfigurator = memo(() => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)

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
      messages?.length !== current?.length ||
      !isMessagesIdentificial(messages, current)
    ) {
      setCurrent(messages)
    }
  }, [messages, current, loadModelError])

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
    const parentRef = useRef(null)

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
      if (count > 0 && messages && virtualizer) {
        virtualizer.scrollToIndex(count - 1)
      }
    }, [count, virtualizer, messages, loadModelError])

    const items = virtualizer.getVirtualItems()
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _,
      instance
    ) => {
      return (
        // item.start < (instance.scrollOffset ?? 0) &&
        instance.scrollDirection !== 'backward'
      )
    }

    return (
      <div className="flex h-full w-full flex-col overflow-x-hidden">
        <div
          ref={parentRef}
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
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                >
                  {loadModelError && virtualRow.index === count - 1 ? (
                    <LoadModelError />
                  ) : (
                    <ChatItem
                      {...messages[virtualRow.index]}
                      // key={messages[virtualRow.index]?.id}
                      loadModelError={loadModelError}
                      isCurrentMessage={
                        virtualRow.index === messages?.length - 1
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }
)

export default memo(ChatConfigurator)
