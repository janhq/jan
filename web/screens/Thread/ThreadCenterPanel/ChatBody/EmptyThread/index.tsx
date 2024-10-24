import { memo } from 'react'

import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { isLocalEngine } from '@/utils/modelEngine'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const EmptyThread = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const showOnboardingStep =
    downloadedModels.filter((e) => isLocalEngine(e.engine)).length === 0

  return (
    <div className="mx-auto flex h-full flex-col items-center justify-center text-center">
      <LogoMark className="mx-auto mb-2 animate-wave" width={32} height={32} />
      {showOnboardingStep ? (
        <>
          <p className="mt-1 font-medium">
            {`You don't have a local model yet.`}
          </p>
          <Button
            onClick={() => setMainViewState(MainViewState.Hub)}
            variant="soft"
            className="mt-3"
          >
            Explore The Hub
          </Button>
        </>
      ) : (
        <p className="mt-1 font-medium">How can I help you?</p>
      )}
    </div>
  )
}

export default memo(EmptyThread)
