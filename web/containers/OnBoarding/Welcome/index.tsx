import { Button } from '@janhq/uikit'

import { useAtom } from 'jotai'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { APP_ONBOARDING_FINISH } from '@/containers/Providers/OnboardingListener'

import { onBoardingStepAtom } from '..'

const WelcomeOnBoarding = () => {
  const [onBoardingStep, setOnBoardingStep] = useAtom(onBoardingStepAtom)

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-end gap-8">
      <div className="text-center">
        <LogoMark className="mx-auto animate-wave" width={40} />
        <h1 className="mt-2 text-3xl font-bold">Welcome to Jan</h1>
        <p className="mt-2 text-base font-medium text-muted-foreground">
          Rethinking your computer
        </p>
      </div>

      <div className="flex w-full items-end justify-center">
        <div className="flex-shrink-0 pb-8">
          <Button
            themes="ghost"
            onClick={() => {
              localStorage.setItem(APP_ONBOARDING_FINISH, 'true')
              window.core?.api.relaunch()
            }}
          >
            Skip Setup
          </Button>
        </div>
        <div className="w-3/4">
          <img
            src="images/app-onboarding-frame.png"
            alt="App Frame OnBoarding"
          />
        </div>
        <div className="flex-shrink-0 pb-8">
          <Button onClick={() => setOnBoardingStep(onBoardingStep + 1)}>
            Begin Setup
          </Button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeOnBoarding
