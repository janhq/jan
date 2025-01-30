import { useRef, useState } from 'react'

import {
  EngineManager,
  ErrorCode,
  InferenceEngine,
  ThreadMessage,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { CheckIcon, ClipboardIcon, SearchCodeIcon } from 'lucide-react'

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
  const errorDivRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const getEngine = () => {
    const engineName = activeAssistant?.model?.engine
    return engineName ? EngineManager.instance().get(engineName) : null
  }

  const handleCopy = () => {
    if (errorDivRef.current) {
      const errorText = errorDivRef.current.innerText
      if (errorText) {
        navigator.clipboard.writeText(errorText)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
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
            engine?.name !== InferenceEngine.cortex_llamacpp ? (
              <span>
                No internet connection. <br /> Switch to an on-device model or
                check connection.
              </span>
            ) : (
              <>
                {message?.content[0]?.text?.value && (
                  <AutoLink text={message?.content[0]?.text?.value} />
                )}
              </>
            )}
          </p>
        )
    }
  }

  return (
    <div className="mx-auto my-6 max-w-[700px] px-4">
      <div
        className="mx-auto  max-w-[400px] rounded-lg border border-[hsla(var(--app-border))]"
        key={message.id}
      >
        <div className="flex justify-between border-b border-inherit px-4 py-2">
          <h6 className="text-[hsla(var(--destructive-bg))]">Error</h6>
          <div className="flex items-center gap-x-4 text-xs">
            <div>
              <span
                className="flex cursor-pointer items-center gap-x-1 text-[hsla(var(--app-link))]"
                onClick={() => setModalTroubleShooting(true)}
              >
                <SearchCodeIcon size={14} className="text-inherit" />
                Troubleshooting
              </span>
              <ModalTroubleShooting />
            </div>
            <div
              className="flex cursor-pointer items-center gap-x-1 text-[hsla(var(--text-secondary))]"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <CheckIcon
                    size={14}
                    className="text-[hsla(var(--success-bg))]"
                  />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardIcon size={14} className="text-inherit" />
                  Copy
                </>
              )}
            </div>
          </div>
        </div>
        <div className="max-h-[80px] w-full overflow-x-auto p-4 py-2">
          <div
            className="text-xs leading-relaxed text-[hsla(var(--text-secondary))]"
            ref={errorDivRef}
          >
            {getErrorTitle()}
          </div>
        </div>
      </div>
    </div>
  )
}
export default ErrorMessage
