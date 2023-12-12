import { ExtensionType, ModelRuntimeParams, ThreadState } from '@janhq/core'
import { ConversationalExtension } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  threadModelRuntimeParamsAtom,
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const useGetAllThreads = () => {
  const setThreadStates = useSetAtom(threadStatesAtom)
  const setThreads = useSetAtom(threadsAtom)
  const setThreadModelRuntimeParams = useSetAtom(threadModelRuntimeParamsAtom)

  const getAllThreads = async () => {
    try {
      const threads =
        (await extensionManager
          .get<ConversationalExtension>(ExtensionType.Conversational)
          ?.getThreads()) ?? []

      const threadStates: Record<string, ThreadState> = {}
      const threadModelParams: Record<string, ModelRuntimeParams> = {}

      threads.forEach((thread) => {
        if (thread.id != null) {
          const lastMessage = (thread.metadata?.lastMessage as string) ?? ''

          threadStates[thread.id] = {
            hasMore: true,
            waitingForResponse: false,
            lastMessage,
            isFinishInit: true,
          }

          // model params
          const modelParams = thread.assistants?.[0]?.model?.parameters
          threadModelParams[thread.id] = modelParams
        }
      })

      // updating app states
      setThreadStates(threadStates)
      setThreads(threads)
      setThreadModelRuntimeParams(threadModelParams)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    getAllThreads,
  }
}

export default useGetAllThreads
