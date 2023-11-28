import { Fragment } from 'react'

import { Badge, Button } from '@janhq/uikit'

import LogoMark from '@/containers/Brand/Logo/Mark'

import ShortCut from '@/containers/Shortcut'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

const WelcomeScreen = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const { activeModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center">
        <LogoMark
          className="mx-auto mb-4 animate-wave"
          width={56}
          height={56}
        />

        {downloadedModels.length === 0 && !activeModel && (
          <Fragment>
            <h1
              data-testid="testid-welcome-title"
              className="text-2xl font-bold"
            >
              Welcome to Jan
            </h1>
            <p className="mt-1">{`Let’s download your first model`}</p>
            <Button
              className="mt-4"
              onClick={() => setMainViewState(MainViewState.ExploreModels)}
            >
              Explore Models
            </Button>
          </Fragment>
        )}
        {downloadedModels.length >= 1 && !activeModel && (
          <Fragment>
            <h1 className="mt-2 text-lg font-medium">{`You don’t have any actively running models`}</h1>
            <p className="mt-1">{`Please start a downloaded model to use this feature.`}</p>
            <Badge className="mt-4" themes="outline">
              <ShortCut menu="E" />
              &nbsp; to show your model
            </Badge>
          </Fragment>
        )}
        {downloadedModels.length >= 1 && activeModel && (
          <Fragment>
            <h1 className="mt-2 text-lg font-medium">{`Your Model is Active`}</h1>
            <p className="mt-1">{`You are ready to converse.`}</p>
            <Button
              className="mt-4"
              onClick={() => setMainViewState(MainViewState.Chat)}
            >
              Start a conversation
            </Button>
          </Fragment>
        )}
      </div>
    </div>
  )
}

export default WelcomeScreen
