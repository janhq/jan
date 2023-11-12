import React, { forwardRef } from 'react'

import SimpleTextMessage from '../SimpleTextMessage'
import { ChatMessage } from '@/types/chatMessage'

type Props = {
  message: ChatMessage
}

type Ref = HTMLDivElement

const ChatItem = forwardRef<Ref, Props>(({ message }, ref) => (
  <div ref={ref} className="py-4 even:bg-secondary dark:even:bg-secondary/20">
    <SimpleTextMessage
      status={message.status}
      key={message.id}
      avatarUrl={message.senderAvatarUrl}
      senderName={message.senderName}
      createdAt={message.createdAt}
      senderType={message.messageSenderType}
      text={message.text}
    />
  </div>
))

export default ChatItem
