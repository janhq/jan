import {
  EngineManager,
  ErrorCode,
  MessageStatus,
  ThreadMessage,
} from '@janhq/core'
import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCcw } from 'lucide-react'

import AutoLink from '@/containers/AutoLink'
import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { MainViewState } from '@/constants/screens'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const ErrorMessage = ({ message }: { message: ThreadMessage }) => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { resendChatMessage } = useSendChatMessage()
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeThread = useAtomValue(activeThreadAtom)

  const regenerateMessage = async () => {
    const lastMessageIndex = messages.length - 1
    const message = messages[lastMessageIndex]
    resendChatMessage(message)
  }

  const getErrorTitle = () => {
    switch (message.error_code) {
      case ErrorCode.Unknown:
        return 'Apologies, something’s amiss!'
      case ErrorCode.InvalidApiKey:
      case ErrorCode.InvalidRequestError:
        return (
          <span data-testid="invalid-API-key-error">
            Invalid API key. Please check your API key from{' '}
            <button
              className="text-primary font-medium dark:text-blue-400"
              onClick={() => {
                setMainState(MainViewState.Settings)

                if (activeThread?.assistants[0]?.model.engine) {
                  const engine = EngineManager.instance().get(
                    activeThread.assistants[0].model.engine
                  )
                  engine?.name && setSelectedSettingScreen(engine.name)
                }
              }}
            >
              Settings
            </button>{' '}
            and try again.
          </span>
        )
      default:
        return (
          <>
            {message.content[0]?.text?.value && (
              <AutoLink text={message.content[0].text.value} />
            )}
          </>
        )
    }
  }

  return (
    <div className="mt-10">
      {message.status === MessageStatus.Stopped && (
        <div key={message.id} className="flex flex-col items-center">
          <span className="mb-3 text-center text-sm font-medium text-[hsla(var(--text-secondary))]">
            Oops! The generation was interrupted. Let&apos;s give it another go!
          </span>
          <Button
            className="w-min"
            theme="ghost"
            variant="outline"
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
          className="mx-6 flex flex-col items-center space-y-2 text-center font-medium text-[hsla(var(--text-secondary))]"
        >
          {getErrorTitle()}
          <p>
            Jan’s in beta. Access&nbsp;
            <span
              className="cursor-pointer text-[hsla(var(--app-primary-bg))]"
              onClick={() => setModalTroubleShooting(true)}
            >
              troubleshooting assistance
            </span>
            &nbsp;now.
          </p>
          <ModalTroubleShooting />
        </div>
      )}
    </div>
  )
}
export default ErrorMessage
