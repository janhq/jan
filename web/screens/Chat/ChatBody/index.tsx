import { useAtomValue } from 'jotai'

import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {messages.map((message) => (
        <ChatItem {...message} key={message.id} />
      ))}
    </div>
  )
}

export default ChatBody
