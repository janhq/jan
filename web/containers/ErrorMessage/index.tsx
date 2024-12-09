import {
  EngineManager,
  ErrorCode,
  MessageStatus,
  ThreadMessage,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import AutoLink from '@/containers/AutoLink'
import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { MainViewState } from '@/constants/screens'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const ErrorMessage = ({ message }: { message: ThreadMessage }) => {
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)

  const getErrorTitle = () => {
    switch (message.error_code) {
      case ErrorCode.InvalidApiKey:
      case ErrorCode.AuthenticationError:
        return (
          <span data-testid="invalid-API-key-error">
            Invalid API key. Please check your API key from{' '}
            <button
              className="font-medium text-[hsla(var(--app-link))] underline"
              onClick={() => {
                setMainState(MainViewState.Settings)

                if (activeAssistant?.model.engine) {
                  const engine = EngineManager.instance().get(
                    activeAssistant?.model.engine
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
          <p
            data-testid="passthrough-error-message"
            className="first-letter:uppercase"
          >
            {message.content[0]?.text?.value && (
              <AutoLink text={message.content[0].text.value} />
            )}
          </p>
        )
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-[700px]">
      {message.status === MessageStatus.Error && (
        <div
          key={message.id}
          className="mx-6 flex flex-col items-center space-y-2 text-center font-medium text-[hsla(var(--text-secondary))]"
        >
          {getErrorTitle()}
          <p>
            {`Something's wrong.`} Access&nbsp;
            <span
              className="cursor-pointer text-[hsla(var(--app-link))] underline"
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
