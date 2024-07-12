'use client'

import { useEffect } from 'react'

import useAssistants from '@/hooks/useAssistants'
import useConfigQuery from '@/hooks/useConfigQuery'
import { useLoadTheme } from '@/hooks/useLoadTheme'
import useModelHub from '@/hooks/useModelHub'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

const DataLoader: React.FC = () => {
  const { getAssistantList } = useAssistants()
  const { getThreadList } = useThreads()
  const { getModels } = useModels()

  useConfigQuery()
  useLoadTheme()

  useEffect(() => {
    getAssistantList()
    getThreadList()
    getModels()
  }, [getThreadList, getAssistantList, getModels])

  useModelHub()

  console.debug('Load Data...')
  return null
}

export default DataLoader
