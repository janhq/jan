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

import { extensionManager } from '@/extension'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  getActiveThreadModelParamsAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'
import { ModelParams } from '@/types/model'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'

export type UpdateModelParameter = {
  params?: ModelParams
  modelId?: string
  modelPath?: string
  engine?: InferenceEngine
}

export default function useUpdateModelParameters() {
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const [selectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

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
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.modifyThreadAssistant(thread.id, {
          ...activeAssistant,
          model: {
            ...activeAssistant?.model,
            parameters: runtimeParams,
            settings: settingParams,
          },
        })
    },
    [activeModelParams, selectedModel, activeAssistant, setThreadModelParams]
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
