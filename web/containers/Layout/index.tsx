import React, { PropsWithChildren, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { SidebarLeft, SidebarRight } from '@containers/Sidebar'
import { twMerge } from 'tailwind-merge'
import {
  leftSideBarExpandStateAtom,
  rightSideBarExpandStateAtom,
} from '@helpers/atoms/SideBarExpand.atom'

import Topbar from '@containers/Topbar'
import BottomBar from '@containers/BottomBar'

import { motion as m } from 'framer-motion'

import { getMainViewStateAtom } from '@helpers/atoms/MainView.atom'

const BaseLayout = (props: PropsWithChildren) => {
  const { children } = props
  const isLeftSidebarVisible = useAtomValue(leftSideBarExpandStateAtom)
  const isRightSidebarVisible = useAtomValue(rightSideBarExpandStateAtom)
  const setLeftSideBarVisibility = useSetAtom(leftSideBarExpandStateAtom)
  const setRightSideBarVisibility = useSetAtom(rightSideBarExpandStateAtom)
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
          'border-border bg-background/50 relative top-8 flex h-[calc(100vh-72px)] w-full overflow-hidden rounded-lg border',
          isRightSidebarVisible ? 'mr-0' : 'mr-4'
        )}
      >
        <div className="w-full">
          <Topbar />
          <m.div
            key={viewState}
            initial={{ opacity: 0, y: -8 }}
            className="h-full pb-4"
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
      {/* {isRightSidebarVisible && <SidebarRight />} */}
    </div>
  )
}

export default BaseLayout
