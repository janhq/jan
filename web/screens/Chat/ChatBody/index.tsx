import { Fragment } from 'react'

import ScrollToBottom from 'react-scroll-to-bottom'

import { Button } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import ChatItem from '../ChatItem'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { setMainViewState } = useMainViewState()

  if (downloadedModels.length === 0)
    return (
      <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center text-center">
        <LogoMark
          className="mx-auto mb-4 animate-wave"
          width={56}
          height={56}
        />
        <h1 className="text-2xl font-bold">Welcome!</h1>
        <p className="mt-1 text-base">You need to download your first model</p>
        <Button
          className="mt-4"
          onClick={() => setMainViewState(MainViewState.Hub)}
        >
          Explore The Hub
        </Button>
      </div>
    )

  return (
    <Fragment>
      {messages.length === 0 ? (
        <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center text-center">
          <LogoMark
            className="mx-auto mb-4 animate-wave"
            width={56}
            height={56}
          />
          <p className="mt-1 text-base font-medium">How can i help you?</p>
        </div>
      ) : (
        <ScrollToBottom className="flex h-full w-full flex-col">
          {messages.map((message) => (
            <ChatItem {...message} key={message.id} />
          ))}
        </ScrollToBottom>
      )}
    </Fragment>
  )
}

export default ChatBody
