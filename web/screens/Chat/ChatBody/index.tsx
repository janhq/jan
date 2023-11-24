import { useContext } from 'react'

import { useAtomValue } from 'jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import ChatInstruction from '../ChatInstruction'
import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { experimentalFeatureEnabed } = useContext(FeatureToggleContext)
  return (
    <div className="flex h-full w-full flex-col-reverse overflow-y-auto">
      {messages.map((message) => (
        <ChatItem {...message} key={message.id} />
      ))}
      {experimentalFeatureEnabed && messages.length === 0 && (
        <ChatInstruction />
      )}
    </div>
  )
}

export default ChatBody
