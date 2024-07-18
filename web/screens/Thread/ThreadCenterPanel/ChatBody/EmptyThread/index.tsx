import { Fragment, memo } from 'react'

import { LocalEngines } from '@janhq/core'
import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const EmptyThread: React.FC = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)

  const haveLocalModel = downloadedModels.filter(
    (e) => LocalEngines.find((x) => x === e.engine) != null
  )

  return (
    <div className="mx-auto flex h-full flex-col items-center justify-center text-center">
      <LogoMark className="mx-auto mb-2 animate-wave" width={32} height={32} />
      {haveLocalModel ? (
        <p className="mt-1 font-medium">How can I help you?</p>
      ) : (
        <Fragment>
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
        </Fragment>
      )}
    </div>
  )
}

export default memo(EmptyThread)
