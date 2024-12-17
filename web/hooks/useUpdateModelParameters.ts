import { useCallback } from 'react'

import {
  ConversationalExtension,
  ExtensionTypeEnum,
  InferenceEngine,
  Thread,
  ThreadAssistantInfo,
  extractInferenceParams,
  extractModelLoadParams,
} from '@janhq/core'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { extensionManager } from '@/extension'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  getActiveThreadModelParamsAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'
import { ModelParams } from '@/types/model'

export type UpdateModelParameter = {
  params?: ModelParams
  modelId?: string
  modelPath?: string
  engine?: InferenceEngine
}

export default function useUpdateModelParameters() {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const [activeAssistant, setActiveAssistant] = useAtom(activeAssistantAtom)
  const [selectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

  const updateAssistantExtension = (
    threadId: string,
    assistant: ThreadAssistantInfo
  ) => {
    return extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.modifyThreadAssistant(threadId, assistant)
  }

  const updateAssistantCallback = useDebouncedCallback(
    updateAssistantExtension,
    300
  )

  const updateModelParameter = useCallback(
    async (thread: Thread, settings: UpdateModelParameter) => {
      if (!activeAssistant) return

      const toUpdateSettings = processStopWords(settings.params ?? {})
      const updatedModelParams = settings.modelId
        ? toUpdateSettings
        : {
            ...selectedModel?.parameters,
            ...selectedModel?.settings,
            ...activeModelParams,
            ...toUpdateSettings,
          }

      // update the state
      setThreadModelParams(thread.id, updatedModelParams)
      const runtimeParams = extractInferenceParams(updatedModelParams)
      const settingParams = extractModelLoadParams(updatedModelParams)
      const assistantInfo = {
        ...activeAssistant,
        model: {
          ...activeAssistant?.model,
          parameters: runtimeParams,
          settings: settingParams,
          id: settings.modelId ?? selectedModel?.id ?? activeAssistant.model.id,
          engine:
            settings.engine ??
            selectedModel?.engine ??
            activeAssistant.model.engine,
        },
      }
      setActiveAssistant(assistantInfo)

      updateAssistantCallback(thread.id, assistantInfo)
    },
    [
      activeAssistant,
      selectedModel?.parameters,
      selectedModel?.settings,
      selectedModel?.id,
      selectedModel?.engine,
      activeModelParams,
      setThreadModelParams,
      setActiveAssistant,
      updateAssistantCallback,
    ]
  )

  const processStopWords = (params: ModelParams): ModelParams => {
    if ('stop' in params && typeof params['stop'] === 'string') {
      // Input as string but stop words accept an array of strings (space as separator)
      params['stop'] = (params['stop'] as string)
        .split(' ')
        .filter((e) => e.trim().length)
    }
    return params
  }

  return { updateModelParameter }
}
