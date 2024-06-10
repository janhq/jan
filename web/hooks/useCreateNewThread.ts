import { useCallback } from 'react'

import {
  Assistant,
  ConversationalExtension,
  ExtensionTypeEnum,
  Thread,
  ThreadAssistantInfo,
  Model,
  AssistantTool,
} from '@janhq/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'

import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { useActiveModel } from './useActiveModel'
import useCortex from './useCortex'
import useRecommendedModel from './useRecommendedModel'

import useSetActiveThread from './useSetActiveThread'

import { extensionManager } from '@/extension'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  threadsAtom,
  updateThreadAtom,
  setThreadModelParamsAtom,
  isGeneratingResponseAtom,
} from '@/helpers/atoms/Thread.atom'

const createNewThreadAtom = atom(null, (get, set, newThread: Thread) => {
  // add the new thread on top of the thread list to the state
  const threads = get(threadsAtom)
  set(threadsAtom, [newThread, ...threads])
})

export const useCreateNewThread = () => {
  const createNewThread = useSetAtom(createNewThreadAtom)
  const { setActiveThread } = useSetActiveThread()
  const updateThread = useSetAtom(updateThreadAtom)
  const setFileUpload = useSetAtom(fileUploadAtom)
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

  const experimentalEnabled = useAtomValue(experimentalFeatureEnabledAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)

  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const { stopInference } = useActiveModel()
  const { createThread } = useCortex()

  const requestCreateNewThread = async (
    assistant: Assistant,
    model?: Model | undefined
  ) => {
    // Stop generating if any
    setIsGeneratingResponse(false)
    stopInference()

    const defaultModel = model ?? recommendedModel ?? downloadedModels[0]

    // modify assistant tools when experimental on, retieval toggle enabled in default
    const assistantTools: AssistantTool = {
      type: 'retrieval',
      enabled: true,
      settings: assistant.tools && assistant.tools[0].settings,
    }

    const overriddenSettings =
      defaultModel?.settings?.ctx_len && defaultModel.settings.ctx_len > 2048
        ? { ctx_len: 2048 }
        : {}

    const overriddenParameters =
      defaultModel?.parameters?.max_tokens && defaultModel.parameters.max_tokens
        ? { max_tokens: 2048 }
        : {}

    const createdAt = Date.now()
    const assistantInfo: ThreadAssistantInfo = {
      assistant_id: assistant.id,
      assistant_name: assistant.name,
      tools: experimentalEnabled ? [assistantTools] : assistant.tools,
      model: {
        id: defaultModel?.id ?? '*',
        settings: { ...defaultModel?.settings, ...overriddenSettings } ?? {},
        parameters:
          { ...defaultModel?.parameters, ...overriddenParameters } ?? {},
        engine: defaultModel?.engine,
      },
      instructions: assistant.instructions,
    }

    const createdThread = await createThread([assistantInfo])
    const thread: Thread = {
      id: createdThread.id,
      object: 'thread',
      title: 'New Thread',
      assistants: [assistantInfo],
      created: createdAt,
      updated: createdAt,
    }

    // add the new thread on top of the thread list to the state
    createNewThread(thread)

    setSelectedModel(defaultModel)
    setThreadModelParams(thread.id, {
      ...defaultModel?.settings,
      ...defaultModel?.parameters,
      ...overriddenSettings,
    })

    // Delete the file upload state
    setFileUpload([])
    // Update thread metadata
    await updateThreadMetadata(thread)

    setActiveThread(thread)
  }

  const updateThreadMetadata = useCallback(
    async (thread: Thread) => {
      updateThread(thread)

      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.saveThread(thread)
    },
    [updateThread]
  )

  return {
    requestCreateNewThread,
    updateThreadMetadata,
  }
}
