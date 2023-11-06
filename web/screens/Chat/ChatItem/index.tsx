import React, { forwardRef } from 'react'

import SimpleTextMessage from '../SimpleTextMessage'

type Props = {
  message: ChatMessage
}

type Ref = HTMLDivElement

const ChatItem = forwardRef<Ref, Props>(({ message }, ref) => {
  return (
    <div ref={ref} className="py-4 even:bg-secondary/20">
      <SimpleTextMessage
        key={message.id}
        avatarUrl={message.senderAvatarUrl}
        senderName={message.senderName}
        createdAt={message.createdAt}
        senderType={message.messageSenderType}
        text={message.text}
      />
    </div>
  )
})

export default ChatItem
