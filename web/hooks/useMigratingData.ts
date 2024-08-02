/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from 'react'

import { useAtom } from 'jotai'

import useAssistantQuery from './useAssistantQuery'

import useCortex from './useCortex'
import useMessageCreateMutation from './useMessageCreateMutation'
import useThreads from './useThreads'

import {
  threadsMessagesMigrationSuccessAtom,
  modelsMigrationSuccessAtom,
} from '@/helpers/atoms/AppConfig.atom'

const useMigratingData = () => {
  const [threadsMessagesMigrationSuccess, setThreadsMessagesMigrationSuccess] =
    useAtom(threadsMessagesMigrationSuccessAtom)
  const [modelsMigrationSuccess, setModelsMigrationSuccess] = useAtom(
    modelsMigrationSuccessAtom
  )
  const { createThread } = useThreads()
  const { updateThread } = useCortex()
  const createMessage = useMessageCreateMutation()
  const { data: assistants } = useAssistantQuery()

  const getJanThreadsAndMessages = useCallback(async (): Promise<{
    messages: any[]
    threads: any[]
  }> => {
    return window?.electronAPI?.getAllMessagesAndThreads()
  }, [])

  const getJanLocalModels = useCallback(async (): Promise<{
    hasLocalModels: boolean
  }> => {
    return window?.electronAPI?.getAllLocalModels()
  }, [])

  const migrateModels = useCallback(async () => {
    try {
      if (!modelsMigrationSuccess) {
        await window?.electronAPI?.syncModelFileToCortex()
        setModelsMigrationSuccess(true)
      }
    } catch (err) {
      console.log(err)
      setModelsMigrationSuccess(false)
    }
  }, [modelsMigrationSuccess, setModelsMigrationSuccess])

  const migrateThreadsAndMessages = useCallback(async () => {
    if (!assistants || assistants.length === 0) {
      console.error('No assistant found')
      return
    }
    try {
      if (threadsMessagesMigrationSuccess) return
      const threadsAndMessages = await getJanThreadsAndMessages()
      const janThreads = threadsAndMessages.threads
      for (const thread of janThreads) {
        const modelId: string | undefined = thread.assistants[0]?.model?.id
        if (!modelId || modelId.trim().length === 0 || modelId === '*') {
          console.error(
            `Ignore thread ${thread.id} because modelId is not found`
          )
          continue
        }
        const threadTitle: string = thread.title ?? 'New Thread'
        const instructions: string = thread.assistants[0]?.instructions ?? ''
        // currently, we don't have api support for creating thread with messages
        const cortexThread = await createThread(modelId, assistants[0])
        console.log('createThread', cortexThread)
        // update instruction
        cortexThread.assistants[0].instructions = instructions
        cortexThread.title = threadTitle

        // update thread name
        await updateThread(cortexThread)
        console.log('updateThread', cortexThread)

        // we finished with thread, now continue with messages
        const janMessages = threadsAndMessages.messages.filter(
          (m) => m.thread_id === thread.id
        )
        console.log(janMessages)
        for (let j = 0; j < janMessages.length; ++j) {
          const janMessage = janMessages[j]
          // filter out the system message if any
          if (janMessage.role === 'system') continue
          try {
            const messageContent: string =
              janMessage.content[0]?.text.value ?? ''

            // can speed up here with Promise.allSettled
            await createMessage.mutateAsync({
              threadId: cortexThread.id,
              createMessageParams: {
                content: messageContent,
                role: janMessage.role,
              },
            })
          } catch (err) {
            console.error(err)
          }
        }
        setThreadsMessagesMigrationSuccess(true)
      }
    } catch (err) {
      console.log(err)
      setThreadsMessagesMigrationSuccess(false)
    }
  }, [
    assistants,
    getJanThreadsAndMessages,
    threadsMessagesMigrationSuccess,
    createThread,
    updateThread,
    setThreadsMessagesMigrationSuccess,
    createMessage,
  ])

  return {
    migrateModels,
    migrateThreadsAndMessages,
    getJanThreadsAndMessages,
    getJanLocalModels,
  }
}

export default useMigratingData
