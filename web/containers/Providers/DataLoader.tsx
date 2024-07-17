'use client'

import { useEffect } from 'react'

import useAssistantCreate, { janAssistant } from '@/hooks/useAssistantCreate'
import useAssistantQuery from '@/hooks/useAssistantQuery'
import useConfigQuery from '@/hooks/useConfigQuery'
import useEngineQuery from '@/hooks/useEngineQuery'
import { useLoadTheme } from '@/hooks/useLoadTheme'
import useModelHub from '@/hooks/useModelHub'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

const DataLoader: React.FC = () => {
  const { getThreadList } = useThreads()
  const { getModels } = useModels()
  const { data: assistants } = useAssistantQuery()
  const assistantCreateMutation = useAssistantCreate()

  useEffect(() => {
    if (!assistants) return
    if (assistants.length === 0 && assistantCreateMutation.isIdle) {
      // empty assistant. create new one
      console.debug('Empty assistants received. Create Jan Assistant...')
      assistantCreateMutation.mutate(janAssistant)
    }
  }, [assistants, assistantCreateMutation])

  useConfigQuery()
  useModelHub()
  useLoadTheme()
  useEngineQuery()

  useEffect(() => {
    getThreadList()
    getModels()
  }, [getThreadList, getModels])

  console.debug('Load Data...')
  return null
}

export default DataLoader
