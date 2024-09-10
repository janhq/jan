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

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import {
  extractRuntimeParams,
  extractModelLoadParams,
} from '@/utils/modelParam'

import useRecommendedModel from './useRecommendedModel'

import { extensionManager } from '@/extension'
import { preserveModelSettingsAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  selectedModelAtom,
  updateDownloadedModelAtom,
} from '@/helpers/atoms/Model.atom'
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
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const updateDownloadedModel = useSetAtom(updateDownloadedModelAtom)
  const preserveModelFeatureEnabled = useAtomValue(preserveModelSettingsAtom)
  const { recommendedModel, setRecommendedModel } = useRecommendedModel()

  const updateModelParameter = useCallback(
    async (thread: Thread, settings: UpdateModelParameter) => {
      const toUpdateSettings = processStopWords(settings.params ?? {})
      const updatedModelParams = settings.modelId
        ? toUpdateSettings
        : { ...activeModelParams, ...toUpdateSettings }

      // update the state
      setThreadModelParams(thread.id, updatedModelParams)
      const runtimeParams = extractRuntimeParams(updatedModelParams)
      const settingParams = extractModelLoadParams(updatedModelParams)

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
      if (preserveModelFeatureEnabled) {
        const defaultContextLength = settingParams.ctx_len
        const defaultMaxTokens = runtimeParams.max_tokens

        // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
        const { ctx_len, ...toSaveSettings } = settingParams
        // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
        const { max_tokens, ...toSaveParams } = runtimeParams

        const updatedModel = {
          id: settings.modelId ?? selectedModel?.id,
          parameters: {
            ...toSaveSettings,
          },
          settings: {
            ...toSaveParams,
          },
          metadata: {
            default_ctx_len: defaultContextLength,
            default_max_tokens: defaultMaxTokens,
          },
        } as Partial<Model>

        const model = await extensionManager
          .get<ModelExtension>(ExtensionTypeEnum.Model)
          ?.updateModelInfo(updatedModel)
        if (model) updateDownloadedModel(model)
        if (selectedModel?.id === model?.id) setSelectedModel(model)
        if (recommendedModel?.id === model?.id) setRecommendedModel(model)
      }
    },
    [
      activeModelParams,
      selectedModel,
      setThreadModelParams,
      preserveModelFeatureEnabled,
      updateDownloadedModel,
      setSelectedModel,
      recommendedModel,
      setRecommendedModel,
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
