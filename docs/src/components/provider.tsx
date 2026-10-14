'use client'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'
import SearchDialog from '@/components/search'
import { Analytics } from '@/components/analytics'

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{ SearchDialog }}
      // The old docs were light-only (Nextra `forcedTheme: 'light'`).
      theme={{ forcedTheme: 'light', defaultTheme: 'light', hotKey: false }}
    >
      <Analytics />
      {children}
    </RootProvider>
  )
}
