import React from 'react'

// import { useSetAtom } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

// import {
//   setMainViewStateAtom,
//   MainViewState,
// } from '@/helpers/atoms/MainView.atom'

const WelcomeScreen = () => {
  // const setMainViewState = useSetAtom(setMainViewStateAtom)

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center">
        <LogoMark
          className="animate-wave mx-auto mb-4"
          width={56}
          height={56}
        />
        <h1 data-testid="testid-welcome-title" className="text-2xl font-bold">
          Welcome to Jan
        </h1>
        <p className="">{`let’s download your first model`}</p>
        {/* <div className="mt-4">
          <button onClick={() => setMainViewState(MainViewState.ExploreModel)}>
            Explore Models
          </button>
        </div> */}
      </div>
    </div>
  )
}

export default WelcomeScreen
