import React, { forwardRef, useEffect, useState } from 'react'

import {
  events,
  MessageEvent,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'

import ErrorMessage from '@/containers/ErrorMessage'

import MessageContainer from '../TextMessage'

type Ref = HTMLDivElement

type Props = {
  loadModelError?: string
  isCurrentMessage?: boolean
} & ThreadMessage

const ChatItem = forwardRef<Ref, Props>((message, ref) => {
  const [content, setContent] = useState<ThreadContent[]>(message.content)
  const [status, setStatus] = useState<MessageStatus>(message.status)
  const [errorMessage, setErrorMessage] = useState<ThreadMessage | undefined>(
    message.isCurrentMessage && !!message?.metadata?.error ? message : undefined
  )

  function onMessageUpdate(data: ThreadMessage) {
    if (data.id === message.id) {
      setContent(data.content)
      if (data.status !== status) setStatus(data.status)
      if (data.status === MessageStatus.Error && message.isCurrentMessage)
        setErrorMessage(data)
    }
  }

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
