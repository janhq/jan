/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConversationalExtension,
  ExtensionTypeEnum,
  InferenceEngine,
  Thread,
  ThreadAssistantInfo,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import { extensionManager } from '@/extension'
import {
  ModelParams,
  activeThreadStateAtom,
  getActiveThreadModelParamsAtom,
  setThreadModelParamsAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

export type UpdateModelParameter = {
  params?: ModelParams
  modelId?: string
  engine?: InferenceEngine
}

export default function useUpdateModelParameters() {
  const threads = useAtomValue(threadsAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const activeThreadState = useAtomValue(activeThreadStateAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const updateModelParameter = async (
    threadId: string,
    settings: UpdateModelParameter
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

    const params = settings.modelId
      ? settings.params
      : { ...activeModelParams, ...settings.params }

    const updatedModelParams: ModelParams = {
      ...params,
    }

    // update the state
    setThreadModelParams(thread.id, updatedModelParams)

    const assistants = thread.assistants.map(
      (assistant: ThreadAssistantInfo) => {
        const runtimeParams = toRuntimeParams(updatedModelParams)
        const settingParams = toSettingParams(updatedModelParams)

        assistant.model.parameters = runtimeParams
        assistant.model.settings = settingParams
        if (selectedModel) {
          assistant.model.id = settings.modelId ?? selectedModel?.id
          assistant.model.engine = settings.engine ?? selectedModel?.engine
        }
        return assistant
      }
    )

    // update thread
    const updatedThread: Thread = {
      ...thread,
      assistants,
    }

    await extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.saveThread(updatedThread)
  }

  return { updateModelParameter }
}
