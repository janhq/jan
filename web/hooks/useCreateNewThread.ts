import { useCallback } from 'react'

import {
  ConversationalExtension,
  ExtensionTypeEnum,
  Thread,
  ThreadAssistantInfo,
  ThreadState,
  AssistantTool,
  Model,
  Assistant,
} from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { copyOverInstructionEnabledAtom } from '@/containers/CopyInstruction'
import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { useActiveModel } from './useActiveModel'
import useRecommendedModel from './useRecommendedModel'

import useSetActiveThread from './useSetActiveThread'

import { extensionManager } from '@/extension'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  threadsAtom,
  threadStatesAtom,
  updateThreadAtom,
  setThreadModelParamsAtom,
  isGeneratingResponseAtom,
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
  const [activeAssistant, setActiveAssistant] = useAtom(activeAssistantAtom)

  const experimentalEnabled = useAtomValue(experimentalFeatureEnabledAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)

  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const threads = useAtomValue(threadsAtom)
  const { stopInference } = useActiveModel()

  const requestCreateNewThread = async (
    assistant: (ThreadAssistantInfo & { id: string; name: string }) | Assistant,
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

    // Default context length is 8192
    const defaultContextLength = Math.min(
      8192,
      defaultModel?.settings.ctx_len ?? 8192
    )

    const overriddenSettings = {
      ctx_len: defaultContextLength,
    }

    // Use ctx length by default
    const overriddenParameters = {
      max_tokens: defaultContextLength,
    }

    const createdAt = Date.now()
    let instructions: string | undefined = assistant.instructions
    if (copyOverInstructionEnabled) {
      instructions = activeAssistant?.instructions ?? undefined
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

    const thread: Partial<Thread> = {
      object: 'thread',
      title: 'New Thread',
      assistants: [assistantInfo],
      created: createdAt,
      updated: createdAt,
      metadata: {
        title: 'New Thread',
      },
    }

    // add the new thread on top of the thread list to the state
    //TODO: Why do we have thread list then thread states? Should combine them
    try {
      const createdThread = await persistNewThread(thread, assistantInfo)
      if (!createdThread) throw 'Thread creation failed'
      createNewThread(createdThread)

      setSelectedModel(defaultModel)
      setThreadModelParams(createdThread.id, {
        ...defaultModel?.settings,
        ...defaultModel?.parameters,
        ...overriddenSettings,
      })

      // Delete the file upload state
      setFileUpload([])
      setActiveThread(createdThread)
    } catch (ex) {
      return toaster({
        title: 'Thread created failed.',
        description: `To avoid piling up empty threads, please reuse previous one before creating new.`,
        type: 'error',
      })
    }
  }

  const updateThreadExtension = (thread: Thread) => {
    return extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.modifyThread(thread)
  }

  const updateAssistantExtension = (
    threadId: string,
    assistant: ThreadAssistantInfo
  ) => {
    return extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.modifyThreadAssistant(threadId, assistant)
  }

  const updateThreadCallback = useDebouncedCallback(updateThreadExtension, 300)
  const updateAssistantCallback = useDebouncedCallback(
    updateAssistantExtension,
    300
  )

  const updateThreadMetadata = useCallback(
    async (thread: Thread) => {
      updateThread(thread)

      setActiveAssistant(thread.assistants[0])
      updateThreadCallback(thread)
      updateAssistantCallback(thread.id, thread.assistants[0])
    },
    [
      updateThread,
      setActiveAssistant,
      updateThreadCallback,
      updateAssistantCallback,
    ]
  )

  const persistNewThread = async (
    thread: Partial<Thread>,
    assistantInfo: ThreadAssistantInfo
  ): Promise<Thread | undefined> => {
    return await extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.createThread(thread)
      .then(async (thread) => {
        await extensionManager
          .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
          ?.createThreadAssistant(thread.id, assistantInfo)
        return thread
      })
  }

  return {
    requestCreateNewThread,
    updateThreadMetadata,
  }
}
