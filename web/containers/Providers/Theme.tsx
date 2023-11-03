'use client'

import { PropsWithChildren } from 'react'

import { ThemeProvider } from 'next-themes'

import { motion as m } from 'framer-motion'

import { useUserConfigs } from '@/hooks/useUserConfigs'

export default function ThemeWrapper({ children }: PropsWithChildren) {
  const [config] = useUserConfigs()

  return (
    <ThemeProvider attribute="class" enableSystem>
      <m.div
        className={config.accent}
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
