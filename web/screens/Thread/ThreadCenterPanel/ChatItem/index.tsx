import React, { forwardRef, useEffect, useState } from 'react'

import {
  events,
  MessageEvent,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'

import SimpleTextMessage from '../SimpleTextMessage'

type Ref = HTMLDivElement

const ChatItem = forwardRef<Ref, ThreadMessage>((message, ref) => {
  const [content, setContent] = useState<ThreadContent[]>(message.content)
  const [status, setStatus] = useState<MessageStatus>(message.status)

  function onMessageUpdate(data: ThreadMessage) {
    if (data.id === message.id) {
      setContent(data.content)
      if (data.status !== status) setStatus(data.status)
    }
  }

  useEffect(() => {
    if (message.status === MessageStatus.Pending)
      events.on(MessageEvent.OnMessageUpdate, onMessageUpdate)
    return () => {
      events.off(MessageEvent.OnMessageUpdate, onMessageUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={ref} className="relative">
      <SimpleTextMessage {...message} content={content} status={status} />
    </div>
  )
})

export default ChatItem
