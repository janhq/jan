import {
  ExtensionType,
  ModelRuntimeParams,
  Thread,
  ThreadState,
} from '@janhq/core'
import { ConversationalExtension } from '@janhq/core'
import { useAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  threadModelRuntimeParamsAtom,
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const useThreads = () => {
  const [threadStates, setThreadStates] = useAtom(threadStatesAtom)
  const [threads, setThreads] = useAtom(threadsAtom)
  const [threadModelRuntimeParams, setThreadModelRuntimeParams] = useAtom(
    threadModelRuntimeParamsAtom
  )

  const getThreads = async () => {
    try {
      const localThreads = await getLocalThreads()
      const localThreadStates: Record<string, ThreadState> = {}
      const threadModelParams: Record<string, ModelRuntimeParams> = {}

      localThreads.forEach((thread) => {
        if (thread.id != null) {
          const lastMessage = (thread.metadata?.lastMessage as string) ?? ''

          localThreadStates[thread.id] = {
            hasMore: false,
            waitingForResponse: false,
            lastMessage,
            isFinishInit: true,
          }

          // model params
          const modelParams = thread.assistants?.[0]?.model?.parameters
          threadModelParams[thread.id] = modelParams
        }
      })

      // allow at max 1 unfinished init thread and it should be at the top of the list
      let unfinishedThreadId: string | undefined = undefined
      const unfinishedThreadState: Record<string, ThreadState> = {}

      for (const key of Object.keys(threadStates)) {
        const threadState = threadStates[key]
        if (threadState.isFinishInit === false) {
          unfinishedThreadState[key] = threadState
          unfinishedThreadId = key
          break
        }
      }
      const unfinishedThread: Thread | undefined = threads.find(
        (thread) => thread.id === unfinishedThreadId
      )

      let allThreads: Thread[] = [...localThreads]
      if (unfinishedThread) {
        allThreads = [unfinishedThread, ...localThreads]
      }

      if (unfinishedThreadId) {
        localThreadStates[unfinishedThreadId] =
          unfinishedThreadState[unfinishedThreadId]

        threadModelParams[unfinishedThreadId] =
          threadModelRuntimeParams[unfinishedThreadId]
      }

      // updating app states
      setThreadStates(localThreadStates)
      setThreads(allThreads)
      setThreadModelRuntimeParams(threadModelParams)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    getAllThreads: getThreads,
  }
}

const getLocalThreads = async (): Promise<Thread[]> =>
  (await extensionManager
    .get<ConversationalExtension>(ExtensionType.Conversational)
    ?.getThreads()) ?? []

export default useThreads
