import { useCallback } from 'react'

import {
  Assistant,
  ConversationalExtension,
  ExtensionTypeEnum,
  Thread,
  ThreadAssistantInfo,
  ThreadState,
  AssistantTool,
  Model,
} from '@janhq/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'

import { copyOverInstructionEnabledAtom } from '@/containers/CopyInstruction'
import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { generateThreadId } from '@/utils/thread'

import { useActiveModel } from './useActiveModel'
import useRecommendedModel from './useRecommendedModel'

import useSetActiveThread from './useSetActiveThread'

import { extensionManager } from '@/extension'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  threadsAtom,
  threadStatesAtom,
  updateThreadAtom,
  setThreadModelParamsAtom,
  isGeneratingResponseAtom,
  activeThreadAtom,
} from '@/helpers/atoms/Thread.atom'

const createNewThreadAtom = atom(null, (get, set, newThread: Thread) => {
  // create thread state for this new thread
  const currentState = { ...get(threadStatesAtom) }

  const threadState: ThreadState = {
    hasMore: false,
    waitingForResponse: false,
    lastMessage: undefined,
  }
  currentState[newThread.id] = threadState
  set(threadStatesAtom, currentState)

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
  const copyOverInstructionEnabled = useAtomValue(
    copyOverInstructionEnabledAtom
  )
  const activeThread = useAtomValue(activeThreadAtom)

  const experimentalEnabled = useAtomValue(experimentalFeatureEnabledAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)

  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const threads = useAtomValue(threadsAtom)
  const { stopInference } = useActiveModel()

  const requestCreateNewThread = async (
    assistant: Assistant,
    model?: Model | undefined
  ) => {
    // Stop generating if any
    setIsGeneratingResponse(false)
    stopInference()

    const defaultModel = model ?? recommendedModel ?? downloadedModels[0]

    if (!model) {
      // if we have model, which means user wants to create new thread from Model hub. Allow them.

      // check last thread message, if there empty last message use can not create thread
      const lastMessage = threads[0]?.metadata?.lastMessage

      if (!lastMessage && threads.length) {
        return toaster({
          title: 'No new thread created.',
          description: `To avoid piling up empty threads, please reuse previous one before creating new.`,
          type: 'warning',
        })
      }
    }

    // modify assistant tools when experimental on, retieval toggle enabled in default
    const assistantTools: AssistantTool = {
      type: 'retrieval',
      enabled: true,
      settings: assistant.tools && assistant.tools[0].settings,
    }
    const overriddenSettings =
      defaultModel?.settings.ctx_len && defaultModel.settings.ctx_len > 2048
        ? { ctx_len: 4096 }
        : {}

    const overriddenParameters = defaultModel?.parameters.max_tokens
      ? { max_tokens: 4096 }
      : {}

    const createdAt = Date.now()
    let instructions: string | undefined = assistant.instructions
    if (copyOverInstructionEnabled) {
      instructions = activeThread?.assistants[0]?.instructions ?? undefined
    }
    const assistantInfo: ThreadAssistantInfo = {
      assistant_id: assistant.id,
      assistant_name: assistant.name,
      tools: experimentalEnabled ? [assistantTools] : assistant.tools,
      model: {
        id: defaultModel?.id ?? '*',
        settings: { ...defaultModel?.settings, ...overriddenSettings },
        parameters: { ...defaultModel?.parameters, ...overriddenParameters },
        engine: defaultModel?.engine,
      },
      instructions,
    }

    const threadId = generateThreadId(assistant.id)
    const thread: Thread = {
      id: threadId,
      object: 'thread',
      title: 'New Thread',
      assistants: [assistantInfo],
      created: createdAt,
      updated: createdAt,
    }

    // add the new thread on top of the thread list to the state
    //TODO: Why do we have thread list then thread states? Should combine them
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
