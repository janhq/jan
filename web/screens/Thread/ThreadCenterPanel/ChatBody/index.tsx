import { useAtomValue } from 'jotai'

import ListContainer from '@/containers/ListContainer'

import SimpleTextMessage from '../SimpleTextMessage'

import EmptyThread from './EmptyThread'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  if (!messages.length) return <EmptyThread />

  return (
    <ListContainer>
      {messages.map((message, index) => {
        const isLatestMessage = index === messages.length - 1
        return (
          <SimpleTextMessage
            key={message.id}
            msg={message}
            isLatestMessage={isLatestMessage}
          />
        )
      })}
    </ListContainer>
  )
}

export default ChatBody
