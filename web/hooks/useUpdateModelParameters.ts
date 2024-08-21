import { useCallback } from 'react'

import {
  ConversationalExtension,
  ExtensionTypeEnum,
  InferenceEngine,
  Model,
  ModelExtension,
  Thread,
  ThreadAssistantInfo,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import { extensionManager } from '@/extension'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
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
      const toUpdateSettings = processStopWords(settings.params ?? {})
      const updatedModelParams = settings.modelId
        ? toUpdateSettings
        : { ...activeModelParams, ...toUpdateSettings }

      // update the state
      setThreadModelParams(thread.id, updatedModelParams)
      const runtimeParams = toRuntimeParams(updatedModelParams)
      const settingParams = toSettingParams(updatedModelParams)

      const assistants = thread.assistants.map(
        (assistant: ThreadAssistantInfo) => {
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

      // Persists default settings to model file
      // Do not overwrite ctx_len and max_tokens
      if (selectedModel) {
        const updatedModel = {
          ...selectedModel,
          parameters: {
            ...runtimeParams,
            max_tokens: selectedModel.parameters.max_tokens,
          },
          settings: {
            ...settingParams,
            ctx_len: selectedModel.settings.ctx_len,
          },
          metadata: {
            ...selectedModel.metadata,
            default_ctx_len: settingParams.ctx_len,
            default_max_tokens: runtimeParams.max_tokens,
          },
        } as Model

        await extensionManager
          .get<ModelExtension>(ExtensionTypeEnum.Model)
          ?.saveModel(updatedModel)
      }
    },
    [activeModelParams, selectedModel, setThreadModelParams]
  )

  const processStopWords = (params: ModelParams): ModelParams => {
    if ('stop' in params && typeof params['stop'] === 'string') {
      // Input as string but stop words accept an array of strings (space as separator)
      params['stop'] = (params['stop'] as string).split(' ')
    }
    return params
  }

  return { updateModelParameter }
}
