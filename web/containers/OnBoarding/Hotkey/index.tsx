import { Fragment, useEffect, useState } from 'react'

import {
  Button,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'
import { Tooltip } from '@janhq/uikit'
import { useAtom } from 'jotai'
import { ArrowLeftIcon, CommandIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { APP_ONBOARDING_FINISH } from '@/containers/Providers/OnboardingListener'

import useRecordHotkeys from '@/hooks/useRecordHotkeys'

import { onBoardingStepAtom } from '..'

const HotkeyOnBoarding = () => {
  const [onBoardingStep, setOnBoardingStep] = useAtom(onBoardingStepAtom)

  const { keys, start, stop, isRecording, error, isValid, isHotkeyModifier } =
    useRecordHotkeys()

  console.log(keys)

  const getModifierSymbol = (key: string) => {
    if (isHotkeyModifier(key)) {
      switch (key) {
        case 'meta':
          return <CommandIcon size={20} className="mx-auto stroke-2" />
      }
    }
    return key
  }

  return (
    <div className="flex w-full cursor-pointer p-2">
      <div className="item-center flex h-full w-3/5 flex-shrink-0 flex-col items-center justify-between rounded-lg bg-white px-8 py-14 dark:bg-background/50">
        <div className="w-full text-center">
          <h1 className="mt-2 text-3xl font-bold">
            Enable{' '}
            <span className="rounded-l-lg border-r-4 border-yellow-500 bg-yellow-100 p-1 px-2">
              Accessibility
            </span>{' '}
            Permissions
          </h1>
          <p className="mx-auto mt-2 w-full text-base font-medium text-muted-foreground lg:w-3/5">
            Jan’s Quick Ask feature allows you to summon and use AI in any
            application using the following Hotkey:
          </p>

          {/* UI of keycaps */}
          <div className="relative z-50 mb-10 mt-20 flex justify-center gap-4">
            {isRecording ? (
              <>
                {keys.size === 0 ? (
                  <Tooltip open={isRecording}>
                    <TooltipTrigger asChild>
                      <div className="flex gap-4">
                        <div className="keycaps small placeholder" />
                        <div className="keycaps small placeholder" />
                      </div>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent
                        side="top"
                        className="max-w-[240px]"
                        sideOffset={20}
                      >
                        <span>Type & hold your key...</span>
                        <TooltipArrow />
                      </TooltipContent>
                    </TooltipPortal>
                  </Tooltip>
                ) : (
                  <Tooltip open={Boolean(error) || isRecording}>
                    <TooltipTrigger asChild>
                      <div className="flex gap-4">
                        {Array.from(keys).map((key) => {
                          return (
                            <div
                              key={key}
                              className={twMerge(
                                'keycaps uppercase',
                                key.length < 8 && 'small'
                              )}
                            >
                              {getModifierSymbol(key)}
                            </div>
                          )
                        })}
                        {!isValid && (
                          <div className="keycaps small placeholder" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent
                        side="top"
                        className={twMerge(
                          Boolean(error) && 'bg-red-500',
                          isValid && 'bg-green-500'
                        )}
                        sideOffset={20}
                      >
                        <span
                          className={twMerge(Boolean(error) && 'text-white')}
                        >
                          {error ||
                            (isValid && 'Your new key is set!') ||
                            'Type & hold your key...'}
                        </span>
                        <TooltipArrow
                          className={twMerge(
                            Boolean(error) && 'fill-red-500',
                            isValid && 'fill-green-500'
                          )}
                        />
                      </TooltipContent>
                    </TooltipPortal>
                  </Tooltip>
                )}
              </>
            ) : (
              <Tooltip open={isValid}>
                <TooltipTrigger asChild>
                  <div className="flex gap-4">
                    <Fragment>
                      {Array.from(keys).map((key) => {
                        return (
                          <div
                            key={key}
                            className={twMerge(
                              'keycaps uppercase',
                              key.length < 8 && 'small'
                            )}
                          >
                            {getModifierSymbol(key)}
                          </div>
                        )
                      })}
                      {Array.from(keys).length === 0 && (
                        <>
                          <div className="keycaps small uppercase">
                            {getModifierSymbol(isMac ? 'meta' : 'ctrl')}
                          </div>
                          <div className="keycaps small uppercase">J</div>
                        </>
                      )}
                    </Fragment>
                  </div>
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent
                    side="top"
                    className={twMerge('bg-green-500')}
                    sideOffset={20}
                  >
                    <span className={twMerge(Boolean(error) && 'text-white')}>
                      Your new key is set!
                    </span>
                    <TooltipArrow className={twMerge('fill-green-500')} />
                  </TooltipContent>
                </TooltipPortal>
              </Tooltip>
            )}
          </div>

          <div className="inline-block">
            {isRecording ? (
              <span className="cursor-pointer" onClick={stop}>
                Cancel
              </span>
            ) : (
              <span className="cursor-pointer" onClick={start}>
                Edit Hotkey
              </span>
            )}
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
            onClick={() => {
              setOnBoardingStep(onBoardingStep + 1)
              if (isValid && keys.size > 0) {
                const key = Array.from(keys)
                  .map((key) => key.charAt(0).toUpperCase() + key.slice(1))
                  .join('+')
                localStorage.setItem('quickAskHotkey', key)
                localStorage.setItem(APP_ONBOARDING_FINISH, 'true')
                window.core?.api.relaunch()
              } else {
                localStorage.setItem('quickAskHotkey', 'CommandOrControl+J')
              }
            }}
          >
            Continue
          </Button>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center justify-center"></div>
    </div>
  )
}

export default HotkeyOnBoarding
