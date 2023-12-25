import React, { PropsWithChildren, useEffect } from 'react'

import { useTheme } from 'next-themes'

import { motion as m } from 'framer-motion'

import BottomBar from '@/containers/Layout/BottomBar'
import RibbonNav from '@/containers/Layout/Ribbon'

import TopBar from '@/containers/Layout/TopBar'

import { useMainViewState } from '@/hooks/useMainViewState'

const BaseLayout = (props: PropsWithChildren) => {
  const { children } = props
  const { mainViewState } = useMainViewState()

  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setTheme(theme as string)
  }, [setTheme, theme])

  return (
    <div className="flex h-screen w-screen flex-1 overflow-hidden">
      <RibbonNav />
      <div className=" relative top-12 flex h-[calc(100vh-96px)] w-full overflow-hidden bg-background">
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
    </div>
  )
}

export default BaseLayout
