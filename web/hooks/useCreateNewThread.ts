import { useContext } from 'react'

import {
  Assistant,
  ConversationalExtension,
  ExtensionTypeEnum,
  Thread,
  ThreadAssistantInfo,
  ThreadState,
  Model,
  AssistantTool,
  events,
  InferenceEvent,
} from '@janhq/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'
import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { generateThreadId } from '@/utils/thread'

import useRecommendedModel from './useRecommendedModel'

import useSetActiveThread from './useSetActiveThread'

import { extensionManager } from '@/extension'

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
  const { experimentalFeature } = useContext(FeatureToggleContext)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)

  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const threads = useAtomValue(threadsAtom)

  const requestCreateNewThread = async (
    assistant: Assistant,
    model?: Model | undefined
  ) => {
    // Stop generating if any
    setIsGeneratingResponse(false)
    events.emit(InferenceEvent.OnInferenceStopped, {})

    const defaultModel = model ?? recommendedModel ?? downloadedModels[0]

    // check last thread message, if there empty last message use can not create thread
    const lastMessage = threads[0]?.metadata?.lastMessage

    if (!lastMessage && threads.length) {
      return null
    }

    // modify assistant tools when experimental on, retieval toggle enabled in default
    const assistantTools: AssistantTool = {
      type: 'retrieval',
      enabled: true,
      settings: assistant.tools && assistant.tools[0].settings,
    }

    const createdAt = Date.now()
    const assistantInfo: ThreadAssistantInfo = {
      assistant_id: assistant.id,
      assistant_name: assistant.name,
      tools: experimentalFeature ? [assistantTools] : assistant.tools,
      model: {
        id: defaultModel?.id ?? '*',
        settings: defaultModel?.settings ?? {},
        parameters: defaultModel?.parameters ?? {},
        engine: defaultModel?.engine,
      },
      instructions: assistant.instructions,
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
    })

    // Delete the file upload state
    setFileUpload([])
    // Update thread metadata
    await updateThreadMetadata(thread)

    setActiveThread(thread)
  }

  async function updateThreadMetadata(thread: Thread) {
    updateThread(thread)

    await extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.saveThread(thread)
  }

  return {
    requestCreateNewThread,
    updateThreadMetadata,
  }
}
