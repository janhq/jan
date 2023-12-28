import { Fragment } from 'react'

import ScrollToBottom from 'react-scroll-to-bottom'

import {
  ChatCompletionRole,
  ConversationalExtension,
  ExtensionType,
  InferenceEngine,
  MessageStatus,
} from '@janhq/core'
import { Button } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import { RefreshCcw } from 'lucide-react'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatItem from '../ChatItem'

import { extensionManager } from '@/extension'
import {
  deleteMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { setMainViewState } = useMainViewState()
  const thread = useAtomValue(activeThreadAtom)
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const { resendChatMessage } = useSendChatMessage()

  const regenerateMessage = async () => {
    const lastMessageIndex = messages.length - 1
    const message = messages[lastMessageIndex]
    if (message.role !== ChatCompletionRole.User) {
      // Delete last response before regenerating
      deleteMessage(message.id ?? '')
      if (thread) {
        await extensionManager
          .get<ConversationalExtension>(ExtensionType.Conversational)
          ?.writeMessages(
            thread.id,
            messages.filter((msg) => msg.id !== message.id)
          )
      }
      const targetMessage = messages[lastMessageIndex - 1]
      if (targetMessage) resendChatMessage(targetMessage)
    } else {
      resendChatMessage(message)
    }
  }

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

  const showOnboardingStep =
    downloadedModels.filter((e) => e.engine === InferenceEngine.nitro)
      .length === 0

  return (
    <Fragment>
      {messages.length === 0 ? (
        <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center text-center">
          <LogoMark
            className="mx-auto mb-4 animate-wave"
            width={56}
            height={56}
          />
          {showOnboardingStep ? (
            <>
              <p className="mt-1 text-base font-medium">
                {`You don't have a local model yet.`}
              </p>
              <div className="w-auto px-4 py-2">
                <Button
                  block
                  className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
                  onClick={() => setMainViewState(MainViewState.Hub)}
                >
                  Explore The Hub
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-base font-medium">How can I help you?</p>
          )}
        </div>
      ) : (
        <ScrollToBottom className="flex h-full w-full flex-col">
          {messages.map((message, index) => (
            <div key={message.id}>
              <ChatItem {...message} key={message.id} />

              {message.status === MessageStatus.Error &&
                index === messages.length - 1 && (
                  <div
                    key={message.id}
                    className="mt-10 flex flex-col items-center"
                  >
                    <span className="mb-3 text-center text-sm font-medium text-gray-500">
                      Oops! The generation was interrupted. Let&apos;s give it
                      another go!
                    </span>
                    <Button
                      className="w-min"
                      themes="outline"
                      onClick={regenerateMessage}
                    >
                      <RefreshCcw size={14} className="" />
                      <span className="w-2" />
                      Regenerate
                    </Button>
                  </div>
                )}
            </div>
          ))}
        </ScrollToBottom>
      )}
    </Fragment>
  )
}

export default ChatBody
