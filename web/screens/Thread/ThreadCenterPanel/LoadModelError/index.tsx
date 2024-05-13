import { EngineManager } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { MainViewState } from '@/constants/screens'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import { useSettings } from '@/hooks/useSettings'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const LoadModelError = () => {
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const { settings } = useSettings()

  const PORT_NOT_AVAILABLE = 'PORT_NOT_AVAILABLE'

  const ErrorMessage = () => {
    if (loadModelError === PORT_NOT_AVAILABLE) {
      return (
        <p>
          Port 3928 is currently unavailable. Check for conflicting apps, or
          access&nbsp;
          <span
            className="cursor-pointer text-[hsla(var(--text-link))]"
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
            className="cursor-pointer font-medium text-[hsla(var(--text-link))]"
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
    } else if (
      settings &&
      settings.run_mode === 'gpu' &&
      !settings.vulkan &&
      (!settings.nvidia_driver?.exist || !settings.cuda?.exist)
    ) {
      return (
        <>
          {!settings?.cuda.exist ? (
            <p>
              The CUDA toolkit may be unavailable. Please use the{' '}
              <span
                className="cursor-pointer font-medium text-[hsla(var(--text-link))]"
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
                Install Additional Dependencies
              </span>{' '}
              setting to proceed with the download / installation process.
            </p>
          ) : (
            <div>
              Problem with Nvidia drivers. Please follow the{' '}
              <a
                className="font-medium text-[hsla(var(--text-link))]"
                href="https://www.nvidia.com/Download/index.aspx"
                target="_blank"
              >
                Nvidia Drivers guideline
              </a>{' '}
              to access installation instructions and ensure proper functioning
              of the application.
            </div>
          )}
        </>
      )
    } else {
      return (
        <div>
          Apologies, something’s amiss!
          <p>
            Jan’s in beta. Access&nbsp;
            <span
              className="cursor-pointer text-[hsla(var(--text-link))]"
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
      <div className="flex w-full flex-col items-center text-center text-sm font-medium text-gray-500">
        <p className="w-[90%]">
          <ErrorMessage />
        </p>
        <ModalTroubleShooting />
      </div>
    </div>
  )
}
export default LoadModelError
