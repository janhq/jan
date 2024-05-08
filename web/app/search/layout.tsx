'use client'

import { useEffect } from 'react'

import ClipboardListener from '@/containers/Providers/ClipboardListener'

import JotaiWrapper from '@/containers/Providers/Jotai'

import { setupCoreServices } from '@/services/coreService'

import Search from './page'

export default function RootLayout() {
  useEffect(() => {
    setupCoreServices()
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white font-sans text-sm antialiased dark:bg-[hsla(var(--app-bg))]">
        <JotaiWrapper>
          <ClipboardListener>
            <Search />
          </ClipboardListener>
        </JotaiWrapper>
      </body>
    </html>
  )
}
