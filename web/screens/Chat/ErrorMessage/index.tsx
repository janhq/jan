import { MessageStatus, ThreadMessage } from '@janhq/core'
import { Button } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCcw } from 'lucide-react'

import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'
import useSendChatMessage from '@/hooks/useSendChatMessage'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ErrorMessage = ({ message }: { message: ThreadMessage }) => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { resendChatMessage } = useSendChatMessage()
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const PORT_NOT_AVAILABLE = 'PORT_NOT_AVAILABLE'

  const regenerateMessage = async () => {
    const lastMessageIndex = messages.length - 1
    const message = messages[lastMessageIndex]
    resendChatMessage(message)
  }

  return (
    <div className="mt-10">
      {message.status === MessageStatus.Stopped && (
        <div key={message.id} className="flex flex-col items-center">
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
        <>
          {loadModelError === PORT_NOT_AVAILABLE ? (
            <div
              key={message.id}
              className="flex w-full flex-col items-center text-center text-sm font-medium text-gray-500"
            >
              <p className="w-[90%]">
                Port 3928 is currently unavailable. Check for conflicting apps,
                or access&nbsp;
                <span
                  className="cursor-pointer text-blue-600"
                  onClick={() => setModalTroubleShooting(true)}
                >
                  troubleshooting assistance
                </span>
                &nbsp;for further support.
              </p>
              <ModalTroubleShooting />
            </div>
          ) : (
            <div
              key={message.id}
              className="flex flex-col items-center text-center text-sm font-medium text-gray-500"
            >
              <p>{`Apologies, something’s amiss!`}</p>
              <p>
                Jan’s in beta. Access&nbsp;
                <span
                  className="cursor-pointer text-blue-600"
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
      )}
    </div>
  )
}
export default ErrorMessage
