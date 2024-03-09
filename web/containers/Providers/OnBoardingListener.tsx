import { Fragment, PropsWithChildren, useEffect } from 'react'

import { useAtom } from 'jotai'

import Onboarding from '@/containers/OnBoarding'

import { MainViewState } from '@/constants/screens'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

export const APP_ONBOARDING_FINISH = 'appOnBoardingFinish'

const OnboardingListener = ({ children }: PropsWithChildren) => {
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)

  useEffect(() => {
    if (localStorage.getItem(APP_ONBOARDING_FINISH) === null) {
      localStorage.setItem(APP_ONBOARDING_FINISH, 'false')
      setMainViewState(MainViewState.Onboarding)
    } else if (
      localStorage.getItem(APP_ONBOARDING_FINISH) === 'false' &&
      mainViewState !== MainViewState.Onboarding
    ) {
      setMainViewState(MainViewState.Onboarding)
    } else if (
      localStorage.getItem(APP_ONBOARDING_FINISH) === 'true' &&
      mainViewState === MainViewState.Onboarding
    ) {
      setMainViewState(MainViewState.Thread)
    }
  }, [mainViewState, setMainViewState])

  if (localStorage.getItem(APP_ONBOARDING_FINISH) === 'false') {
    return (
      <div className="flex h-screen">
        <Onboarding />
      </div>
    )
  }

  return <Fragment>{children}</Fragment>
}

export default OnboardingListener
