import {
  ChatCompletionRole,
  ConversationalExtension,
  ExtensionTypeEnum,
  MessageStatus,
  ThreadMessage,
} from '@janhq/core'
import { Button } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCcw } from 'lucide-react'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { extensionManager } from '@/extension'
import {
  deleteMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const ErrorMessage = ({ message }: { message: ThreadMessage }) => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
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
          .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
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

  return (
    <>
      {message.status === MessageStatus.Stopped && (
        <div key={message.id} className="mt-10 flex flex-col items-center">
          <span className="mb-3 text-center text-sm font-medium text-gray-500">
            Oops! The generation was interrupted. Let&apos;s give it another go!
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
      {message.status === MessageStatus.Error && (
        <div key={message.id} className="mt-10 flex flex-col items-center">
          <span className="mb-3 text-center text-sm font-medium text-gray-500">
            <>
              <p>Apologies, something&apos;s amiss!</p>
              Jan&apos;s in beta. Find troubleshooting guides{' '}
              <a
                href="https://jan.ai/guides/troubleshooting"
                target="_blank"
                className="text-blue-600 hover:underline dark:text-blue-300"
              >
                here
              </a>{' '}
              or reach out to us on{' '}
              <a
                href="https://discord.gg/AsJ8krTT3N"
                target="_blank"
                className="text-blue-600 hover:underline dark:text-blue-300"
              >
                Discord
              </a>{' '}
              for assistance.
            </>
          </span>
        </div>
      )}
    </>
  )
}
export default ErrorMessage
