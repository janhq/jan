'use client'

import { useUserConfigs } from '@hooks/useUserConfigs'
import { ThemeProvider } from 'next-themes'
import { ReactNode } from 'react'
import { motion as m } from 'framer-motion'

type Props = {
  children: ReactNode
}

export const ThemeWrapper: React.FC<Props> = ({ children }) => {
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
