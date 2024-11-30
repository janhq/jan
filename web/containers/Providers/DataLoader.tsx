'use client'

import { Fragment, useEffect } from 'react'

import { AppConfiguration, getUserHomePath } from '@janhq/core'
import { useSetAtom } from 'jotai'

import useAssistants from '@/hooks/useAssistants'
import useGetSystemResources from '@/hooks/useGetSystemResources'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { SettingScreenList } from '@/screens/Settings'

import { defaultJanDataFolderAtom } from '@/helpers/atoms/App.atom'
import {
  janDataFolderPathAtom,
  quickAskEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const DataLoader: React.FC = () => {
  const setJanDataFolderPath = useSetAtom(janDataFolderPathAtom)
  const setQuickAskEnabled = useSetAtom(quickAskEnabledAtom)
  const setJanDefaultDataFolder = useSetAtom(defaultJanDataFolderAtom)
  const setJanSettingScreen = useSetAtom(janSettingScreenAtom)
  const { getData: loadModels } = useModels()

  useThreads()
  useAssistants()
  useGetSystemResources()

  useEffect(() => {
    // Load data once
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const defaultJanDataFolder = await getUserHomePath()

      setJanDefaultDataFolder(defaultJanDataFolder)
    }
    getDefaultJanDataFolder()
  }, [setJanDefaultDataFolder])

  useEffect(() => {
    const janSettingScreen = SettingScreenList.filter(
      (screen) => window.electronAPI || screen !== 'Extensions'
    )
    setJanSettingScreen(janSettingScreen)
  }, [setJanSettingScreen])

  console.debug('Load Data...')

  return <Fragment></Fragment>
}

export default DataLoader
