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
  const activeThread = useAtomValue(activeThreadAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const PORT_NOT_AVAILABLE = 'PORT_NOT_AVAILABLE'

  return (
    <div className="mt-10">
      {loadModelError === PORT_NOT_AVAILABLE ? (
        <div className="flex w-full flex-col items-center text-center text-sm font-medium text-gray-500">
          <p className="w-[90%]">
            Port 3928 is currently unavailable. Check for conflicting apps, or
            access&nbsp;
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
        typeof loadModelError.includes === 'function' &&
        loadModelError.includes('EXTENSION_IS_NOT_INSTALLED') ? (
        <div className="flex w-full flex-col items-center text-center text-sm font-medium text-gray-500">
          <p className="w-[90%]">
            Model is currently unavailable. Please switch to a different model
            or install the{' '}
            <button
              className="font-medium text-primary dark:text-blue-400"
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
            </button>{' '}
            to continue using it.
          </p>
        </div>
      ) : (
        <div className="mx-6 flex flex-col items-center space-y-2 text-center text-sm font-medium text-gray-500">
          Apologies, something’s amiss!
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
    </div>
  )
}
export default LoadModelError
