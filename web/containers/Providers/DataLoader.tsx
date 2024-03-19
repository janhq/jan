'use client'

import { Fragment, ReactNode, useEffect } from 'react'

import { AppConfiguration, getUserHomePath, joinPath } from '@janhq/core'
import { useSetAtom } from 'jotai'

import useAssistants from '@/hooks/useAssistants'
import useGetSystemResources from '@/hooks/useGetSystemResources'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { defaultJanDataFolderAtom } from '@/helpers/atoms/App.atom'
import {
  janDataFolderPathAtom,
  quickAskEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'

type Props = {
  children: ReactNode
}

const DataLoader: React.FC<Props> = ({ children }) => {
  const setJanDataFolderPath = useSetAtom(janDataFolderPathAtom)
  const setQuickAskEnabled = useSetAtom(quickAskEnabledAtom)
  const setJanDefaultDataFolder = useSetAtom(defaultJanDataFolderAtom)

  useModels()
  useThreads()
  useAssistants()
  useGetSystemResources()

  useEffect(() => {
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setJanDataFolderPath(appConfig.data_folder)
        setQuickAskEnabled(appConfig.quick_ask)
      })
  }, [setJanDataFolderPath, setQuickAskEnabled])

  useEffect(() => {
    async function getDefaultJanDataFolder() {
      const homePath = await getUserHomePath()
      const defaultJanDataFolder = await joinPath([homePath, 'jan'])

      setJanDefaultDataFolder(defaultJanDataFolder)
    }
    getDefaultJanDataFolder()
  }, [setJanDefaultDataFolder])

  console.debug('Load Data...')

  return <Fragment>{children}</Fragment>
}

export default DataLoader
