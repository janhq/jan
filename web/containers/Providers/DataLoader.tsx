'use client'

import { useEffect } from 'react'

import { useAtomValue } from 'jotai'

import useAssistantCreate, { janAssistant } from '@/hooks/useAssistantCreate'
import useAssistantQuery from '@/hooks/useAssistantQuery'
import useEngineQuery from '@/hooks/useEngineQuery'
import { useLoadTheme } from '@/hooks/useLoadTheme'
import useModelHub from '@/hooks/useModelHub'
import useModelQuery from '@/hooks/useModelQuery'
import useThreadCreateMutation from '@/hooks/useThreadCreateMutation'
import useThreadQuery from '@/hooks/useThreadQuery'

import { getSelectedModelAtom } from '@/helpers/atoms/Model.atom'
import { threadsAtom } from '@/helpers/atoms/Thread.atom'

const DataLoader: React.FC = () => {
  const selectedModel = useAtomValue(getSelectedModelAtom)
  const allThreads = useAtomValue(threadsAtom)
  const { data: assistants } = useAssistantQuery()
  const { data: models } = useModelQuery()
  const { data: threads, isLoading: isFetchingThread } = useThreadQuery()
  const createThreadMutation = useThreadCreateMutation()
  const assistantCreateMutation = useAssistantCreate()

  useEffect(() => {
    if (!assistants) return
    if (assistants.length === 0 && assistantCreateMutation.isIdle) {
      // empty assistant. create new one
      console.debug('Empty assistants received. Create Jan Assistant...')
      assistantCreateMutation.mutate(janAssistant)
    }
  }, [assistants, assistantCreateMutation])

  // automatically create new thread if thread list is empty
  useEffect(() => {
    if (isFetchingThread) return
    if (allThreads.length > 0) return
    if (!assistants || assistants.length === 0) return
    if (!models || models.length === 0) return
    if (allThreads.length === 0 && !createThreadMutation.isPending) {
      const model = selectedModel ?? models[0]
      const assistant = assistants[0]

      console.log('Create new thread because user have no thread')
      createThreadMutation.mutate({
        modelId: model.id,
        assistant: assistant,
      })
    }
  }, [
    assistants,
    models,
    isFetchingThread,
    threads,
    createThreadMutation,
    allThreads,
    selectedModel,
  ])

  useModelHub()
  useLoadTheme()
  useEngineQuery()

  return null
}

export default DataLoader
