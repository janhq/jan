import { Button } from '@janhq/uikit'
import { useAtom } from 'jotai'

import { ArrowLeftIcon } from 'lucide-react'

import { onBoardingStepAtom } from '..'

const AllSetOnBoarding = () => {
  const [onBoardingStep, setOnBoardingStep] = useAtom(onBoardingStepAtom)

  return (
    <div className="flex w-full cursor-pointer p-2">
      <div className="item-center flex h-full w-3/5 flex-shrink-0 flex-col items-center justify-between rounded-lg bg-white px-8 py-14 dark:bg-background/50">
        <div className="w-full text-center">
          <h1 className="mt-2 text-3xl font-bold">All Set!</h1>
          <p className="mt-2 text-base font-medium text-muted-foreground">
            Enter your email to get notified of latest releases and features.
          </p>
        </div>
        <div className="flex w-3/4 gap-4">
          <Button
            size="lg"
            themes="outline"
            className="w-12 p-0"
            onClick={() => setOnBoardingStep(onBoardingStep - 1)}
          >
            <ArrowLeftIcon size={20} />
          </Button>
          <Button block size="lg">
            Get Started
          </Button>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center justify-center"></div>
    </div>
  )
}

export default AllSetOnBoarding
