'use client'

import { useEffect } from 'react'

import useAssistants from '@/hooks/useAssistants'
import useCortexConfig from '@/hooks/useCortexConfig'
import { useLoadTheme } from '@/hooks/useLoadTheme'
import useModelHub from '@/hooks/useModelHub'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

const DataLoader: React.FC = () => {
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

  console.debug('Load Data...')
  return null
}

export default DataLoader
