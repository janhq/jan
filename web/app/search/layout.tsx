'use client'

import { useEffect } from 'react'

import { AppConfiguration, getJanDataFolderPath } from '@janhq/core'

import { useSetAtom } from 'jotai'

import ClipboardListener from '@/containers/Providers/ClipboardListener'

import JotaiWrapper from '@/containers/Providers/Jotai'
import ThemeWrapper from '@/containers/Providers/Theme'

import { useLoadTheme } from '@/hooks/useLoadTheme'

import { setupCoreServices } from '@/services/coreService'

import Search from './page'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

export default function RootLayout() {
  const setJanDataFolderPath = useSetAtom(janDataFolderPathAtom)

  useEffect(() => {
    setupCoreServices()
  }, [])

  useEffect(() => {
    getJanDataFolderPath()?.then((path: string) => {
      setJanDataFolderPath(path)
    })
  }, [setJanDataFolderPath])

  useLoadTheme()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <JotaiWrapper>
          <ThemeWrapper>
            <ClipboardListener />
            <Search />
          </ThemeWrapper>
        </JotaiWrapper>
      </body>
    </html>
  )
}
