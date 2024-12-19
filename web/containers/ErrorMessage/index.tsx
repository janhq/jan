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

import { isLocalEngine } from '@/utils/modelEngine'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const ErrorMessage = ({ message }: { message: ThreadMessage }) => {
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)

  const defaultDesc = () => {
    return (
      <>
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
      </>
    )
  }

  const getEngine = () => {
    const engineName = activeAssistant?.model?.engine
    return engineName ? EngineManager.instance().get(engineName) : null
  }

  const getErrorTitle = () => {
    const engine = getEngine()

    switch (message.metadata?.error_code) {
      case ErrorCode.InvalidApiKey:
      case ErrorCode.AuthenticationError:
        return (
          <>
            <span data-testid="invalid-API-key-error">
              Invalid API key. Please check your API key from{' '}
              <button
                className="font-medium text-[hsla(var(--app-link))] underline"
                onClick={() => {
                  setMainState(MainViewState.Settings)
                  engine?.name && setSelectedSettingScreen(engine.name)
                }}
              >
                Settings
              </button>{' '}
              and try again.
            </span>
            {defaultDesc()}
          </>
        )
      default:
        return (
          <p
            data-testid="passthrough-error-message"
            className="first-letter:uppercase"
          >
            {message.content[0]?.text?.value === 'Failed to fetch' &&
            engine &&
            !isLocalEngine(String(engine?.name)) ? (
              <span>
                No internet connection. <br /> Switch to an on-device model or
                check connection.
              </span>
            ) : (
              <>
                {message?.content[0]?.text?.value && (
                  <AutoLink text={message?.content[0]?.text?.value} />
                )}
                {defaultDesc()}
              </>
            )}
          </p>
        )
    }
  }

  return (
    <div className="mx-auto my-6 max-w-[700px]">
      {!!message.metadata?.error && (
        <div
          key={message.id}
          className="mx-6 flex flex-col items-center space-y-2 text-center font-medium text-[hsla(var(--text-secondary))]"
        >
          {getErrorTitle()}
        </div>
      )}
    </div>
  )
}
export default ErrorMessage
