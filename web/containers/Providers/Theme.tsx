'use client'

import { PropsWithChildren } from 'react'

import { ThemeProvider } from 'next-themes'

import { motion as m } from 'framer-motion'

export default function ThemeWrapper({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" forcedTheme="light">
      <m.div
        initial={{ opacity: 0, y: -10 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.5,
            type: 'spring',
            stiffness: 200,
          },
        }}
      >
        {children}
      </m.div>
    </ThemeProvider>
  )
}
