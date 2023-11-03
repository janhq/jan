import React, { PropsWithChildren, useEffect } from 'react'

import { useTheme } from 'next-themes'

import { motion as m } from 'framer-motion'

// import { useAtomValue } from 'jotai'

// import { twMerge } from 'tailwind-merge'

import BottomBar from '@/containers/Layout/BottomBar'
import RibbonNav from '@/containers/Layout/Ribbon'

import TopBar from '@/containers/Layout/TopBar'
// import { SidebarRight } from '@/containers/Sidebar'

import { useMainViewState } from '@/hooks/useMainViewState'

// import { rightSideBarExpandStateAtom } from '@/helpers/atoms/SideBarExpand.atom'

const BaseLayout = (props: PropsWithChildren) => {
  const { children } = props
  const { mainViewState } = useMainViewState()

  // const isRightSidebarVisible = useAtomValue(rightSideBarExpandStateAtom)

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
      <RibbonNav />
      <div className=" relative top-8 flex h-[calc(100vh-64px)] w-full overflow-hidden bg-background/50">
        <div className="w-full">
          <TopBar />
          <m.div
            key={mainViewState}
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
      {/* {viewState === MainViewState.BotInfo && isRightSidebarVisible && (
        <SidebarRight />
      )} */}
    </div>
  )
}

export default BaseLayout
