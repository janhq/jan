import { useEffect } from 'react'

import {
  ExtensionTypeEnum,
  Thread,
  ThreadState,
  ConversationalExtension,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  threadDataReadyAtom,
  threadModelParamsAtom,
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'
import { ModelParams } from '@/types/model'

const useThreads = () => {
  const setThreadStates = useSetAtom(threadStatesAtom)
  const setThreads = useSetAtom(threadsAtom)
  const setThreadModelRuntimeParams = useSetAtom(threadModelParamsAtom)
  const setThreadDataReady = useSetAtom(threadDataReadyAtom)

  useEffect(() => {
    const getThreads = async () => {
      const localThreads = (await getLocalThreads()).sort((a, b) => {
        return ((a.metadata?.updated_at as number) ?? 0) >
          ((b.metadata?.updated_at as number) ?? 0)
          ? -1
          : 1
      })
      const localThreadStates: Record<string, ThreadState> = {}
      const threadModelParams: Record<string, ModelParams> = {}

      localThreads.forEach((thread) => {
        if (thread.id != null) {
          const lastMessage = (thread.metadata?.lastMessage as string) ?? ''

          localThreadStates[thread.id] = {
            hasMore: false,
            waitingForResponse: false,
            lastMessage,
          }

          const modelParams = thread.assistants?.[0]?.model?.parameters
          const engineParams = thread.assistants?.[0]?.model?.settings
          threadModelParams[thread.id] = {
            ...modelParams,
            ...engineParams,
          }
        }
      })

      // updating app states
      setThreadStates(localThreadStates)
      setThreads(localThreads)
      setThreadModelRuntimeParams(threadModelParams)
      setThreadDataReady(true)
    }

    getThreads()
  }, [
    setThreadModelRuntimeParams,
    setThreadStates,
    setThreads,
    setThreadDataReady,
  ])
}

const getLocalThreads = async (): Promise<Thread[]> =>
  (await extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.listThreads()) ?? []

export default useThreads
