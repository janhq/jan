import { useCallback } from 'react'

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
  getActiveThreadModelParamsAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export type UpdateModelParameter = {
  params?: ModelParams
  modelId?: string
  engine?: InferenceEngine
}

export default function useUpdateModelParameters() {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

  const updateModelParameter = useCallback(
    async (thread: Thread, settings: UpdateModelParameter) => {
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
    },
    [activeModelParams, selectedModel, setThreadModelParams]
  )

  return { updateModelParameter }
}
