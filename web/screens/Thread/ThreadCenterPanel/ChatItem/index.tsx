import React, { forwardRef, useEffect, useState } from 'react'

import { MessageStatus, ThreadMessage } from '@janhq/core'

import ErrorMessage from '@/containers/ErrorMessage'

import MessageContainer from '../TextMessage'

type Ref = HTMLDivElement

type Props = {
  loadModelError?: string
  isCurrentMessage?: boolean
  index: number
} & ThreadMessage

const ChatItem = forwardRef<Ref, Props>((message, ref) => {
  const [errorMessage, setErrorMessage] = useState<ThreadMessage | undefined>(
    message.isCurrentMessage && !!message?.metadata?.error ? message : undefined
  )

  useEffect(() => {
    if (!message.isCurrentMessage && errorMessage) setErrorMessage(undefined)
  }, [message, errorMessage])

  return (
    <>
      {message.status !== MessageStatus.Error &&
        !message.metadata?.error &&
        message.content?.length > 0 && (
          <div ref={ref} className="relative">
            <MessageContainer
              {...message}
              content={message.content}
              status={message.status}
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
