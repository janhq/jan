import { memo, useEffect, useState } from 'react'

import { motion as m } from 'framer-motion'
import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import HubScreen from '@/screens/Hub'
import LocalServerScreen from '@/screens/LocalServer'
import SettingsScreen from '@/screens/Settings'
import ThreadScreen from '@/screens/Thread'

import {
  mainViewStateAtom,
  showSystemMonitorPanelAtom,
} from '@/helpers/atoms/App.atom'

const MainViewContainer = () => {
  const mainViewState = useAtomValue(mainViewStateAtom)
  const showSystemMonitorPanel = useAtomValue(showSystemMonitorPanelAtom)
  const [height, setHeight] = useState<number>(0)

  useEffect(() => {
    if (showSystemMonitorPanel) {
      const element = document.querySelector('.system-monitor-panel')

      if (element) {
        setHeight(element.clientHeight) // You can also use offsetHeight if needed
      }
    } else {
      setHeight(0)
    }
  }, [showSystemMonitorPanel])

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
    <div
      className={twMerge('relative flex w-[calc(100%-48px)]')}
      style={{ height: `calc(100% - ${height}px)` }}
    >
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
