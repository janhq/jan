'use client'

import { useEffect } from 'react'

import ClipboardListener from '@/containers/Providers/ClipboardListener'

import JotaiWrapper from '@/containers/Providers/Jotai'
import ThemeWrapper from '@/containers/Providers/Theme'

import { setupCoreServices } from '@/services/coreService'

import Search from './page'

export default function RootLayout() {
  useEffect(() => {
    setupCoreServices()
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-[hsla(var(--app-bg))] font-sans text-sm antialiased">
        <JotaiWrapper>
          <ThemeWrapper>
            <ClipboardListener>
              <Search />
            </ClipboardListener>
          </ThemeWrapper>
        </JotaiWrapper>
      </body>
    </html>
  )
}
