import React, { PropsWithChildren, useEffect } from 'react'

import { useTheme } from 'next-themes'

import { motion as m } from 'framer-motion'

import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import BottomBar from '@/containers/BottomBar'
import { SidebarLeft, SidebarRight } from '@/containers/Sidebar'
import Topbar from '@/containers/Topbar'

import { getMainViewStateAtom } from '@/helpers/atoms/MainView.atom'
import { MainViewState } from '@/helpers/atoms/MainView.atom'
import { rightSideBarExpandStateAtom } from '@/helpers/atoms/SideBarExpand.atom'

const BaseLayout = (props: PropsWithChildren) => {
  const { children } = props

  const isRightSidebarVisible = useAtomValue(rightSideBarExpandStateAtom)
  const viewState = useAtomValue(getMainViewStateAtom)

  const { theme } = useTheme()

  // Force set theme native
  useEffect(() => {
    async function setTheme() {
      switch (theme) {
        case 'light':
          return await window?.electronAPI.setNativeThemeLight()
        case 'dark':
          return await window?.electronAPI.setNativeThemeDark()
        default:
          return await window?.electronAPI.setNativeThemeSystem()
      }
    }
    setTheme()
  }, [theme])

  return (
    <div className="flex h-screen w-screen flex-1 overflow-hidden">
      <SidebarLeft />
      <div
        className={twMerge(
          'border-border relative top-8 flex h-[calc(100vh-72px)] w-full overflow-hidden rounded-lg border bg-background/50',
          viewState === MainViewState.BotInfo && isRightSidebarVisible
            ? 'mr-0'
            : 'mr-4'
        )}
      >
        <div className="w-full">
          <Topbar />
          <m.div
            key={viewState}
            initial={{ opacity: 0, y: -8 }}
            className="h-full"
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.5,
              },
            }}
          >
            {children}
          </m.div>
          <BottomBar />
        </div>
      </div>
      {viewState === MainViewState.BotInfo && isRightSidebarVisible && (
        <SidebarRight />
      )}
    </div>
  )
}

export default BaseLayout
