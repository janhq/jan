import { ErrorCode, MessageStatus, ThreadMessage } from '@janhq/core'
import { Button } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCcw } from 'lucide-react'

import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { MainViewState } from '@/constants/screens'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'
import useSendChatMessage from '@/hooks/useSendChatMessage'

import { getErrorTitle } from '@/utils/errorMessage'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

const ErrorMessage = ({ message }: { message: ThreadMessage }) => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { resendChatMessage } = useSendChatMessage()
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const PORT_NOT_AVAILABLE = 'PORT_NOT_AVAILABLE'

  const regenerateMessage = async () => {
    const lastMessageIndex = messages.length - 1
    const message = messages[lastMessageIndex]
    resendChatMessage(message)
  }

  const errorTitle = getErrorTitle(
    message.error_code ?? ErrorCode.Unknown,
    message.content[0]?.text?.value
  )

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
                  className="cursor-pointer text-primary dark:text-blue-400"
                  onClick={() => setModalTroubleShooting(true)}
                >
                  troubleshooting assistance
                </span>
                &nbsp;for further support.
              </p>
              <ModalTroubleShooting />
            </div>
          ) : loadModelError &&
            loadModelError?.includes('EXTENSION_IS_NOT_INSTALLED') ? (
            <div
              key={message.id}
              className="flex w-full flex-col items-center text-center text-sm font-medium text-gray-500"
            >
              <p className="w-[90%]">
                Model is currently unavailable. Please switch to a different
                model or install the{' '}
                <button
                  className="font-medium text-blue-500"
                  onClick={() => setMainState(MainViewState.Settings)}
                >
                  {loadModelError.split('::')[1] ?? ''}
                </button>{' '}
                to continue using it.
              </p>
            </div>
          ) : (
            <div
              key={message.id}
              className="flex flex-col items-center text-center text-sm font-medium text-gray-500"
            >
              <p>{errorTitle}</p>
              <p>
                Jan’s in beta. Access&nbsp;
                <span
                  className="cursor-pointer text-primary dark:text-blue-400"
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
