import { useAtomValue } from 'jotai'

import ChatInstruction from '../ChatInstruction'
import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { useActiveModel } from '@/hooks/useActiveModel'
import { activeThreadAtom } from '@/helpers/atoms/Conversation.atom'
import { useEffect } from 'react'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {messages.map((message) => (
        <ChatItem {...message} key={message.id} />
      ))}
      {messages.length === 0 && <ChatInstruction />}
    </div>
  )
}

export default ChatBody
