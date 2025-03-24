'use client'

import { useEffect } from 'react'

import { AppConfiguration, getUserHomePath } from '@janhq/core'

import { useSetAtom } from 'jotai'

import ClipboardListener from '@/containers/Providers/ClipboardListener'

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
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setJanDataFolderPath(appConfig.data_folder)
      })
  }, [setJanDataFolderPath])

  useEffect(() => {
    async function getDefaultJanDataFolder() {
      const defaultJanDataFolder = await getUserHomePath()

      setJanDefaultDataFolder(defaultJanDataFolder)
    }
    getDefaultJanDataFolder()
  }, [setJanDefaultDataFolder])

  useLoadTheme()

  return (
    <ThemeWrapper>
      <ClipboardListener />
      <Search />
    </ThemeWrapper>
  )
}
