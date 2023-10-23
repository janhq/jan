import React from 'react'
import CompactLogo from '@containers/Logo/CompactLogo'
import { useSetAtom } from 'jotai'
import {
  setMainViewStateAtom,
  MainViewState,
} from '@helpers/atoms/MainView.atom'

import { Button } from '@uikit'

const WelcomeScreen = () => {
  const setMainViewState = useSetAtom(setMainViewStateAtom)

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center">
        <CompactLogo width={40} height={40} />
        <h1 className="text-2xl font-bold leading-snug">Welcome to Jan</h1>
        <p className="text-base tracking-wide text-gray-600 dark:text-gray-400">{`let’s download your first model`}</p>
        <div className="mt-4">
          <Button
            themes="accent"
            onClick={() => setMainViewState(MainViewState.ExploreModel)}
          >
            Explore Models
          </Button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeScreen
