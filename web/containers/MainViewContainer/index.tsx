import { memo } from 'react'

import { motion as m } from 'framer-motion'
import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import HubScreen from '@/screens/Hub'
import LocalServerScreen from '@/screens/LocalServer'
import SettingsScreen from '@/screens/Settings'
import ThreadScreen from '@/screens/Thread'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const MainViewContainer = () => {
  const mainViewState = useAtomValue(mainViewStateAtom)

  let children = null
  switch (mainViewState) {
    case MainViewState.Hub:
      children = <HubScreen />
      break

    case MainViewState.Settings:
      children = <SettingsScreen />
      break

    case MainViewState.LocalServer:
      children = <LocalServerScreen />
      break

    default:
      children = <ThreadScreen />
      break
  }

  return (
    <div className={twMerge('relative flex w-[calc(100%-48px)]')}>
      <div className="w-full">
        <m.div
          key={mainViewState}
          initial={{ opacity: 0, y: -8 }}
          className="h-full"
          animate={{
            opacity: 1,
            y: 0,
            transition: {
              duration: 0.25,
            },
          }}
        >
          {children}
        </m.div>
      </div>
    </div>
  )
}

export default memo(MainViewContainer)
