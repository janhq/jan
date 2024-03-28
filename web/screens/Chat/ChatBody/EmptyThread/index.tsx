import React from 'react'

import { InferenceEngine } from '@janhq/core'
import { Button } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const EmptyThread: React.FC = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const showOnboardingStep =
    downloadedModels.filter((e) => e.engine === InferenceEngine.nitro)
      .length === 0

  return (
    <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center text-center">
      <LogoMark className="mx-auto mb-4 animate-wave" width={56} height={56} />
      {showOnboardingStep ? (
        <>
          <p className="mt-1 text-base font-medium">
            {`You don't have a local model yet.`}
          </p>
          <div className="w-auto px-4 py-2">
            <Button
              block
              className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
              onClick={() => setMainViewState(MainViewState.Hub)}
            >
              Explore The Hub
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-base font-medium">How can I help you?</p>
      )}
    </div>
  )
}

export default React.memo(EmptyThread)
