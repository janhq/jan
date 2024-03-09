import { Button } from '@janhq/uikit'
import { useAtom } from 'jotai'

import { ArrowLeftIcon } from 'lucide-react'

import DataFolder from '@/screens/Settings/Advanced/DataFolder'

import { onBoardingStepAtom } from '..'

const DataFolderOnBoarding = () => {
  const [onBoardingStep, setOnBoardingStep] = useAtom(onBoardingStepAtom)

  return (
    <div className="flex w-full p-2">
      <div className="item-center flex h-full w-3/5 flex-shrink-0 flex-col items-center justify-between rounded-lg bg-white px-8 py-14 dark:bg-background/50">
        <div className="w-full text-center">
          <h1 className="mt-2 text-3xl font-bold">
            Choose a{' '}
            <span className="rounded-l-lg border-r-4 border-blue-500 bg-blue-100 p-1 px-2">
              Data Folder
            </span>
          </h1>
          <p className="mx-auto mt-2 w-full text-base font-medium text-muted-foreground lg:w-3/5">
            Jan runs AI models locally on your computer. We need a place to
            store them.
          </p>
          <div className="mx-auto mt-10 flex w-3/5 items-center gap-x-3">
            <DataFolder onBoarding />
          </div>
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
          <Button
            block
            size="lg"
            onClick={() => setOnBoardingStep(onBoardingStep + 1)}
          >
            Continue
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-center">
        <img
          src="images/app-onboarding-data-folder.png"
          alt="Data folder OnBoarding"
        />
      </div>
    </div>
  )
}

export default DataFolderOnBoarding
