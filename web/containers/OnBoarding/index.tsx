import { Fragment } from 'react'

import { atom, useAtomValue } from 'jotai'

import AllSetOnBoarding from './AllSet'
import DataFolderOnBoarding from './DataFolder'
import HotkeyOnBoarding from './Hotkey'
import WelcomeOnBoarding from './Welcome'

export const onBoardingStepAtom = atom<number>(0)
export const modalOnboardingAccesibilityAtom = atom<boolean>(false)

const OnBoarding = () => {
  const onBoardingStep = useAtomValue(onBoardingStepAtom)

  let screen = null
  switch (onBoardingStep) {
    case 1:
      screen = <DataFolderOnBoarding />
      break

    case 2:
      screen = <HotkeyOnBoarding />
      break

    case 3:
      screen = <AllSetOnBoarding />
      break

    default:
      screen = <WelcomeOnBoarding />
      break
  }

  return <Fragment>{screen}</Fragment>
}

export default OnBoarding
