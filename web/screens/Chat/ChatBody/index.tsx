import { Fragment } from 'react'

import ScrollToBottom from 'react-scroll-to-bottom'

import { useAtomValue } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  return (
    <Fragment>
      {messages.length === 0 ? (
        <div className="mx-auto mt-8 flex h-full w-3/4 flex-col items-center justify-center text-center">
          <LogoMark
            className="mx-auto mb-4 animate-wave"
            width={56}
            height={56}
          />
          <p className="mt-1 text-base">You need to choose a model</p>
        </div>
      ) : (
        <>
          <ScrollToBottom className="flex h-full w-full flex-col">
            {messages.map((message) => (
              <ChatItem {...message} key={message.id} />
            ))}
          </ScrollToBottom>
        </>
      )}
    </Fragment>
  )
}

export default ChatBody
