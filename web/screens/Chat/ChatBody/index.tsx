import { useAtomValue } from 'jotai'

import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  return (
    <div className="flex h-full flex-1 flex-col-reverse overflow-y-auto p-4">
      {messages.map((message) => (
        <ChatItem message={message} key={message.id} />
      ))}
    </div>
  )
}

export default ChatBody
