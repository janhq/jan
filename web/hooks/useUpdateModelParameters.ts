import {
  ConversationalExtension,
  ExtensionType,
  ModelRuntimeParams,
  Thread,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import {
  activeThreadStateAtom,
  setThreadModelRuntimeParamsAtom,
  threadsAtom,
  updateThreadAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useUpdateModelParameters() {
  const threads = useAtomValue(threadsAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const setThreadModelRuntimeParams = useSetAtom(
    setThreadModelRuntimeParamsAtom
  )
  const activeThreadState = useAtomValue(activeThreadStateAtom)

  const updateModelParameter = async (
    threadId: string,
    params: ModelRuntimeParams
  ) => {
    const thread = threads.find((thread) => thread.id === threadId)
    if (!thread) {
      console.error(`Thread ${threadId} not found`)
      return
    }

    if (!activeThreadState) {
      console.error('No active thread')
      return
    }

    // update the state
    setThreadModelRuntimeParams(thread.id, params)

    if (!activeThreadState.isFinishInit) {
      // if thread is not initialized, we don't need to update thread.json
      return
    }

    const assistants = thread.assistants.map((assistant) => {
      assistant.model.parameters = params
      return assistant
    })

    // update thread
    const updatedThread: Thread = {
      ...thread,
      assistants,
    }
    updateThread(updatedThread)
    extensionManager
      .get<ConversationalExtension>(ExtensionType.Conversational)
      ?.saveThread(updatedThread)
  }

  return { updateModelParameter }
}
