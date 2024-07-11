'use client'

import { useEffect } from 'react'

import { AppConfiguration } from '@janhq/core'
import { useSetAtom } from 'jotai'

import useAssistants from '@/hooks/useAssistants'
import useCortexConfig from '@/hooks/useCortexConfig'
import { useLoadTheme } from '@/hooks/useLoadTheme'
import useModelHub from '@/hooks/useModelHub'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { SettingScreenList } from '@/screens/Settings'

import {
  janDataFolderPathAtom,
  quickAskEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const DataLoader: React.FC = () => {
  const setJanDataFolderPath = useSetAtom(janDataFolderPathAtom)
  const setQuickAskEnabled = useSetAtom(quickAskEnabledAtom)
  const setJanSettingScreen = useSetAtom(janSettingScreenAtom)

  const { getAssistantList } = useAssistants()
  const { getThreadList } = useThreads()
  const { getModels } = useModels()
  const { getConfig } = useCortexConfig()

  useLoadTheme()

  useEffect(() => {
    getAssistantList()
    getThreadList()
    getModels()
    getConfig()
  }, [getThreadList, getAssistantList, getModels, getConfig])

  useModelHub()

  useEffect(() => {
    // window.core?.api
    //   ?.getAppConfigurations()
    //   ?.then((appConfig: AppConfiguration) => {
    //     setJanDataFolderPath(appConfig.data_folder)
    //     setQuickAskEnabled(appConfig.quick_ask)
    //   })
  }, [setJanDataFolderPath, setQuickAskEnabled])

  // useEffect(() => {
  //   const janSettingScreen = SettingScreenList.filter(
  //     (screen) => window.electronAPI || screen !== 'Extensions'
  //   )
  //   setJanSettingScreen(janSettingScreen)
  // }, [setJanSettingScreen])

  console.debug('Load Data...')
  return null
}

export default DataLoader
