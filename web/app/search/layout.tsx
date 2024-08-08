'use client'

import { useEffect } from 'react'

import { useSetAtom } from 'jotai'

import ClipboardListener from '@/containers/Providers/ClipboardListener'

import JotaiWrapper from '@/containers/Providers/Jotai'
import ThemeWrapper from '@/containers/Providers/Theme'

import { useLoadTheme } from '@/hooks/useLoadTheme'

import { setupCoreServices } from '@/services/coreService'

import Search from './page'

import { defaultJanDataFolderAtom } from '@/helpers/atoms/App.atom'
import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

export default function RootLayout() {
  const setJanDataFolderPath = useSetAtom(janDataFolderPathAtom)
  const setJanDefaultDataFolder = useSetAtom(defaultJanDataFolderAtom)

  useEffect(() => {
    setupCoreServices()
  }, [])

  useEffect(() => {
    window.electronAPI?.appDataFolder()?.then((path: string) => {
      setJanDataFolderPath(path)
    })
  }, [setJanDataFolderPath])

  useEffect(() => {
    async function getDefaultJanDataFolder() {
      const defaultJanDataFolder = await window?.electronAPI.homePath()

      setJanDefaultDataFolder(defaultJanDataFolder)
    }
    getDefaultJanDataFolder()
  }, [setJanDefaultDataFolder])

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
