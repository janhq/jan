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

import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

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
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)

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
        <div
          key={message.id}
          className="flex flex-col items-center text-center text-sm font-medium text-gray-500"
        >
          <p>{`Apologies, something’s amiss!`}</p>
          <p>
            Jan’s in beta. Access&nbsp;
            <span
              className="cursor-pointer text-primary"
              onClick={() => setModalTroubleShooting(true)}
            >
              troubleshooting assistance
            </span>
            &nbsp;now.
          </p>
          <ModalTroubleShooting />
        </div>
      )}
    </>
  )
}
export default ErrorMessage
