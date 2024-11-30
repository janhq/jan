import { memo, useEffect, useState } from 'react'

import { MessageStatus, ThreadMessage } from '@janhq/core'

import { useAtomValue } from 'jotai'

import ErrorMessage from '@/containers/ErrorMessage'
import ListContainer from '@/containers/ListContainer'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import ChatItem from '../ChatItem'

import LoadModelError from '../LoadModelError'

import EmptyThread from './EmptyThread'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatConfigurator = memo(() => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [current, setCurrent] = useState<ThreadMessage[]>([])

  const isMessagesIdentificial = (
    arr1: ThreadMessage[],
    arr2: ThreadMessage[]
  ): boolean => {
    if (arr1.length !== arr2.length) return false
    return arr1.every((item, index) => item.id === arr2[index].id)
  }

  useEffect(() => {
    if (
      messages.length !== current.length ||
      !isMessagesIdentificial(messages, current)
    ) {
      setCurrent(messages)
    }
  }, [messages, current])

  const loadModelError = useAtomValue(loadModelErrorAtom)

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
    return (
      <ListContainer>
        {messages.map((message, index) => (
          <div key={message.id}>
            <ChatItem
              {...message}
              key={message.id}
              loadModelError={loadModelError}
              isCurrentMessage={index === messages.length - 1}
            />
          </div>
        ))}

        {loadModelError && <LoadModelError />}
      </ListContainer>
    )
  }
)

export default memo(ChatConfigurator)
