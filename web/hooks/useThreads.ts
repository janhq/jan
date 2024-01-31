import {
  ExtensionTypeEnum,
  Thread,
  ThreadState,
  ConversationalExtension,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import useSetActiveThread from './useSetActiveThread'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  ModelParams,
  activeThreadAtom,
  threadModelParamsAtom,
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const useThreads = () => {
  const setThreadStates = useSetAtom(threadStatesAtom)
  const setThreads = useSetAtom(threadsAtom)
  const setThreadModelRuntimeParams = useSetAtom(threadModelParamsAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const { setActiveThread } = useSetActiveThread()

  const getThreads = async () => {
    try {
      const localThreads = await getLocalThreads()
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
      if (localThreads.length && !activeThread) {
        setActiveThread(localThreads[0])
      }
    } catch (error) {
      console.error(error)
    }
  }

  return {
    getThreads,
  }
}

const getLocalThreads = async (): Promise<Thread[]> =>
  (await extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.getThreads()) ?? []

export default useThreads
