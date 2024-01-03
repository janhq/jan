/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConversationalExtension,
  ExtensionType,
  Thread,
  ThreadAssistantInfo,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { toRuntimeParams, toSettingParams } from '@/utils/model_param'

import { extensionManager } from '@/extension'
import {
  ModelParams,
  activeThreadStateAtom,
  getActiveThreadModelParamsAtom,
  setThreadModelParamsAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useUpdateModelParameters() {
  const threads = useAtomValue(threadsAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const activeThreadState = useAtomValue(activeThreadStateAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)

  const updateModelParameter = async (
    threadId: string,
    name: string,
    value: number | boolean | string
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
    const updatedModelParams: ModelParams = {
      ...activeModelParams,
      [name]: value,
    }

    // update the state
    setThreadModelParams(thread.id, updatedModelParams)

    if (!activeThreadState.isFinishInit) {
      // if thread is not initialized, we don't need to update thread.json
      return
    }

    const assistants = thread.assistants.map(
      (assistant: ThreadAssistantInfo) => {
        const runtimeParams = toRuntimeParams(updatedModelParams)
        const settingParams = toSettingParams(updatedModelParams)

        assistant.model.parameters = runtimeParams
        assistant.model.settings = settingParams
        return assistant
      }
    )

    // update thread
    const updatedThread: Thread = {
      ...thread,
      assistants,
    }

    await extensionManager
      .get<ConversationalExtension>(ExtensionType.Conversational)
      ?.saveThread(updatedThread)
  }

  return { updateModelParameter }
}
