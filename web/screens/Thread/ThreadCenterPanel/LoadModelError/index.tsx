import { EngineManager } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import ModalTroubleShooting, {
  modalTroubleShootingAtom,
} from '@/containers/ModalTroubleShoot'

import { MainViewState } from '@/constants/screens'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const LoadModelError = () => {
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)

  const ErrorMessage = () => {
    if (
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
              if (activeAssistant?.model.engine) {
                const engine = EngineManager.instance().get(
                  activeAssistant.model.engine
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
        <div className="mx-6 flex flex-col items-center space-y-2 text-center font-medium text-[hsla(var(--text-secondary))]">
          {loadModelError && (
            <p className="first-letter:uppercase">{loadModelError}</p>
          )}
          <p>
            {`Something's wrong.`}&nbsp;Access&nbsp;
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
    <div className="flex flex-1">
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
