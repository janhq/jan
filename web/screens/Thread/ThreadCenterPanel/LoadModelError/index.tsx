import { EngineManager } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { MainViewState } from '@/constants/screens'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const LoadModelError = () => {
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeThread = useAtomValue(activeThreadAtom)

  const PORT_NOT_AVAILABLE = 'PORT_NOT_AVAILABLE'

  const ErrorMessage = () => {
    if (loadModelError === PORT_NOT_AVAILABLE) {
      return (
        <p>
          Port 3928 is currently unavailable. Check for conflicting apps, or
          access&nbsp;
          <span
            className="cursor-pointer text-[hsla(var(--app-link))]"
            onClick={() => setModalTroubleShooting(true)}
          >
            troubleshooting assistance
          </span>
        </p>
      )
    } else if (
      typeof loadModelError?.includes === 'function' &&
      loadModelError.includes('EXTENSION_IS_NOT_INSTALLED')
    ) {
      return (
        <p>
          Model is currently unavailable. Please switch to a different model or
          install the{' '}
          <span
            className="cursor-pointer font-medium text-[hsla(var(--app-link))]"
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
            {loadModelError.split('::')[1] ?? ''}
          </span>{' '}
          to continue using it.
        </p>
      )
    } else {
      return (
        <div>
          Apologies, {`Something's wrong.`}.&nbsp;
          <p>
            Access&nbsp;
            <span
              className="cursor-pointer text-[hsla(var(--app-link))]"
              onClick={() => setModalTroubleShooting(true)}
            >
              troubleshooting assistance
            </span>
            &nbsp;now.
          </p>
        </div>
      )
    }
  }

  return (
    <div className="mt-10">
      <div className="flex w-full flex-col items-center text-center font-medium">
        <p className="w-[90%]">
          <ErrorMessage />
        </p>
        <ModalTroubleShooting />
      </div>
    </div>
  )
}
export default LoadModelError
