/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from 'react'

import {
  EngineStatus,
  LlmEngine,
  RemoteEngine,
  RemoteEngines,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { defaultThreadTitle } from '@/constants/Threads'

import useAssistantQuery from './useAssistantQuery'
import useCortex from './useCortex'
import useEngineInit from './useEngineInit'
import useEngineMutation from './useEngineMutation'
import useEngineQuery from './useEngineQuery'
import useMessageCreateMutation from './useMessageCreateMutation'
import useThreads from './useThreads'

import {
  setMigrationFailedAtom,
  setMigrationSuccessAtom,
  startMigrationAtom,
} from '@/helpers/atoms/Migration.atom'

const useMigratingData = () => {
  const { data: engineData } = useEngineQuery()
  const { data: assistants } = useAssistantQuery()
  const initEngine = useEngineInit()
  const createMessage = useMessageCreateMutation()
  const updateEngineConfig = useEngineMutation()

  const { createThread } = useThreads()
  const { updateThread, getEngineStatus } = useCortex()
  const setMigrationSuccess = useSetAtom(setMigrationSuccessAtom)
  const setMigrationFailed = useSetAtom(setMigrationFailedAtom)
  const startMigration = useSetAtom(startMigrationAtom)

  const getJanThreadsAndMessages = useCallback(
    async (): Promise<{
      messages: any[]
      threads: any[]
    }> => window?.electronAPI?.getAllMessagesAndThreads(),
    []
  )

  const getJanLocalModels = useCallback(async (): Promise<boolean> => {
    // TODO: change the name of this function
    return window?.electronAPI?.getAllLocalModels()
  }, [])

  const migrateApiKeys = useCallback(async () => {
    startMigration('remote-engines')
    try {
      const engineToApiKey: Record<string, string> | undefined =
        await window.core?.api?.syncApiKeys()

      // TODO: Handle the hugging face API key
      if (!engineToApiKey) {
        console.debug('No engineToApiKey found')
        setMigrationSuccess('remote-engines')
        return
      }

      const supportedEngineToApiKeyMap: Record<string, string> = {}
      for (const [engine, apiKey] of Object.entries(engineToApiKey)) {
        if (apiKey && apiKey.trim().length > 0) {
          const normalizedEngineName = engine.replaceAll('-api-key', '')
          if (RemoteEngines.includes(normalizedEngineName as RemoteEngine)) {
            supportedEngineToApiKeyMap[normalizedEngineName as RemoteEngine] =
              apiKey
          } else {
            console.debug(`Skip ${engine} because it's not a valid engine`)
          }
        } else {
          console.debug(`Skip ${engine} because empty API key`)
        }
      }

      // TODO: if an engine is already registered, we skip it
      // register with cortex
      for (const [remoteEngine, apiKey] of Object.entries(
        supportedEngineToApiKeyMap
      )) {
        const engine = remoteEngine as RemoteEngine
        updateEngineConfig.mutateAsync({
          engine: engine,
          config: {
            config: 'apiKey',
            value: apiKey,
          },
        })
      }
      console.debug('Migrate API keys successfully')
      setMigrationSuccess('remote-engines')
    } catch (err) {
      console.error('Error while migrating API keys', err)
      setMigrationFailed('remote-engines')
    }
  }, [
    updateEngineConfig,
    setMigrationSuccess,
    setMigrationFailed,
    startMigration,
  ])

  const initializeEngineSync = useCallback(async () => {
    // for now only pre-init llamacpp
    if (!engineData) {
      console.error("We don't have engine data. Exiting..")
      setMigrationFailed('init-engines')
      return
    }
    startMigration('init-engines')
    try {
      const isLlamaCppInitialized =
        engineData.find((e) => e.name === 'cortex.llamacpp')?.status ===
          EngineStatus.Ready ?? false
      if (isLlamaCppInitialized) {
        console.debug('cortex.llamacpp already initialized')
      } else {
        await initEngine.mutateAsync('cortex.llamacpp' as LlmEngine)

        // loop and wait until engine is initiated
        let continueWaiting = true
        while (continueWaiting) {
          // waiting for 5 secs
          await new Promise((resolve) => setTimeout(resolve, 5000))

          const isInitialized =
            (await getEngineStatus('cortex.llamacpp'))?.status ===
              EngineStatus.Ready ?? false
          console.log('is llamacpp initialized:', isInitialized)
          continueWaiting = !isInitialized
          console.log('continueWaiting', continueWaiting)
        }
      }
      console.debug('Initialize cortex.llamacpp successfully')
      setMigrationSuccess('init-engines')
    } catch (err) {
      console.error('Error while initializing cortex.llamacpp', err)
      setMigrationFailed('init-engines')
    }
  }, [
    engineData,
    initEngine,
    getEngineStatus,
    setMigrationFailed,
    setMigrationSuccess,
    startMigration,
  ])

  const migrateModels = useCallback(async () => {
    startMigration('models')
    try {
      await window?.electronAPI?.syncModelFileToCortex()
      setMigrationSuccess('models')
    } catch (err) {
      console.error('Error while syncing model file to cortex', err)
      setMigrationFailed('models')
    }
  }, [setMigrationSuccess, setMigrationFailed, startMigration])

  const migrateThreadsAndMessages = useCallback(async () => {
    if (!assistants || assistants.length === 0) {
      console.error('No assistant found while migrating threads and messages')
      setMigrationFailed('threads')
      return
    }

    startMigration('threads')
    try {
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
        const threadTitle: string = thread.title ?? defaultThreadTitle
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

        for (let j = 0; j < janMessages.length; ++j) {
          const janMessage = janMessages[j]
          // filter out the system message if any
          if (janMessage.role === 'system') continue
          const messageContent: string = janMessage.content[0]?.text.value ?? ''

          // can speed up here with Promise.allSettled
          await createMessage.mutateAsync({
            threadId: cortexThread.id,
            createMessageParams: {
              content: messageContent,
              role: janMessage.role,
            },
          })
        }
      }
      setMigrationSuccess('threads')
    } catch (err) {
      console.error('Error while migrating threads and messages', err)
      setMigrationFailed('threads')
    }
  }, [
    assistants,
    getJanThreadsAndMessages,
    createThread,
    updateThread,
    createMessage,
    setMigrationFailed,
    setMigrationSuccess,
    startMigration,
  ])

  return {
    migrateApiKeys,
    migrateModels,
    migrateThreadsAndMessages,
    getJanThreadsAndMessages,
    getJanLocalModels,
    initializeEngineSync,
  }
}

export default useMigratingData
