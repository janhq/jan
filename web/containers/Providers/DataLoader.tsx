'use client'

import { Fragment, useEffect } from 'react'

import { EngineEvent, events, getJanDataFolderPath } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import useAssistants from '@/hooks/useAssistants'
import { useGetEngines } from '@/hooks/useEngineManagement'
import useGetSystemResources from '@/hooks/useGetSystemResources'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

import { SettingScreenList } from '@/screens/Settings'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const DataLoader: React.FC = () => {
  const setJanDataFolderPath = useSetAtom(janDataFolderPathAtom)
  const setJanSettingScreen = useSetAtom(janSettingScreenAtom)
  const { getData: loadModels } = useModels()
  const { mutate } = useGetEngines()

  useThreads()
  useAssistants()
  useGetSystemResources()

  useEffect(() => {
    // Load data once
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const reloadData = useDebouncedCallback(() => {
    mutate()
  }, 300)

  useEffect(() => {
    events.on(EngineEvent.OnEngineUpdate, reloadData)
    return () => {
      events.off(EngineEvent.OnEngineUpdate, reloadData)
    }
  }, [reloadData])

  useEffect(() => {
    getJanDataFolderPath()?.then((path: string) => {
      setJanDataFolderPath(path)
    })
  }, [setJanDataFolderPath])

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
