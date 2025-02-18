import { EngineManager, InferenceEngine } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import ErrorMessage from '@/containers/ErrorMessage'

import { MainViewState } from '@/constants/screens'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const LoadModelError = () => {
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const setMainState = useSetAtom(mainViewStateAtom)
  const setSelectedSettingScreen = useSetAtom(selectedSettingAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)

  return (
    <ErrorMessage
      errorComponent={
        <div>
          {typeof loadModelError?.includes === 'function' &&
          loadModelError.includes('EXTENSION_IS_NOT_INSTALLED') ? (
            <>
              <p>
                Model is currently unavailable. Please switch to a different
                model or install the{' '}
                <span
                  className="cursor-pointer font-medium text-[hsla(var(--app-link))]"
                  onClick={() => {
                    setMainState(MainViewState.Settings)
                    if (activeAssistant?.model.engine) {
                      const engine = EngineManager.instance().get(
                        InferenceEngine.cortex
                      )
                      engine?.name && setSelectedSettingScreen(engine.name)
                    }
                  }}
                >
                  {loadModelError.split('::')[1] ?? ''}
                </span>{' '}
                to continue using it.
              </p>
            </>
          ) : (
            <>
              {loadModelError && (
                <p className="first-letter:uppercase">{loadModelError}</p>
              )}
            </>
          )}
        </div>
      }
    />
  )
}
export default LoadModelError
