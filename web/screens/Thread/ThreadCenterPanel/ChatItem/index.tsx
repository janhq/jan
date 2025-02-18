import React, { forwardRef, useEffect, useRef, useState } from 'react'

import {
  events,
  MessageEvent,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'

import { useAtom } from 'jotai'

import ErrorMessage from '@/containers/ErrorMessage'

import MessageContainer from '../TextMessage'

import { subscribedGeneratingMessageAtom } from '@/helpers/atoms/ChatMessage.atom'

type Ref = HTMLDivElement

type Props = {
  loadModelError?: string
  isCurrentMessage?: boolean
  index: number
} & ThreadMessage

const ChatItem = forwardRef<Ref, Props>((message, ref) => {
  const [content, setContent] = useState<ThreadContent[]>(message.content)
  const [status, setStatus] = useState<MessageStatus>(message.status)
  const [subscribedGeneratingMessage, setSubscribedGeneratingMessage] = useAtom(
    subscribedGeneratingMessageAtom
  )
  const [errorMessage, setErrorMessage] = useState<ThreadMessage | undefined>(
    message.isCurrentMessage && !!message?.metadata?.error ? message : undefined
  )
  const subscribedGeneratingMessageRef = useRef(subscribedGeneratingMessage)

  function onMessageUpdate(data: ThreadMessage) {
    if (data.id === message.id) {
      setContent(data.content)
      if (data.status !== status) setStatus(data.status)
      if (data.status === MessageStatus.Error && message.isCurrentMessage)
        setErrorMessage(data)

      // Update subscriber if the message is generating
      if (
        subscribedGeneratingMessageRef.current?.thread_id !== message.thread_id
      )
        setSubscribedGeneratingMessage({
          thread_id: message.thread_id,
        })
    }
  }

  useEffect(() => {
    subscribedGeneratingMessageRef.current = subscribedGeneratingMessage
  }, [subscribedGeneratingMessage])

  useEffect(() => {
    if (!message.isCurrentMessage && errorMessage) setErrorMessage(undefined)
  }, [message, errorMessage])

  useEffect(() => {
    if (message.status === MessageStatus.Pending)
      events.on(MessageEvent.OnMessageUpdate, onMessageUpdate)
    return () => {
      events.off(MessageEvent.OnMessageUpdate, onMessageUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {status !== MessageStatus.Error &&
        !message.metadata?.error &&
        content?.length > 0 && (
          <div ref={ref} className="relative">
            <MessageContainer
              {...message}
              content={content}
              status={status}
              index={message.index}
              isCurrentMessage={message.isCurrentMessage ?? false}
            />
          </div>
        )}
      {errorMessage && !message.loadModelError && (
        <ErrorMessage message={errorMessage} />
      )}
    </>
  )
})

export default ChatItem
