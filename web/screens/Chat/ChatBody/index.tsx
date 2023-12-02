import { useAtomValue } from 'jotai'

import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  return (
    <div className="h-full w-full overflow-y-auto py-4">
      {messages.map((message) => (
        <ChatItem {...message} key={message.id} />
      ))}
    </div>
  )
}

export default ChatBody
