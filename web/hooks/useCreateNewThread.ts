import { useCallback } from 'react'

import {
  ConversationalExtension,
  ExtensionTypeEnum,
  Thread,
  ThreadAssistantInfo,
  AssistantTool,
  Model,
  Assistant,
} from '@janhq/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import useRecommendedModel from './useRecommendedModel'
import useSetActiveThread from './useSetActiveThread'

import { extensionManager } from '@/extension'
import { copyOverInstructionEnabledAtom } from '@/helpers/atoms/App.atom'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  threadsAtom,
  updateThreadAtom,
  setThreadModelParamsAtom,
  createNewThreadAtom,
} from '@/helpers/atoms/Thread.atom'

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

  const threads = useAtomValue(threadsAtom)

  const { recommendedModel } = useRecommendedModel()

  const selectedModel = useAtomValue(selectedModelAtom)

  const requestCreateNewThread = async (
    assistant: (ThreadAssistantInfo & { id: string; name: string }) | Assistant,
    model?: Model | undefined
  ) => {
    const defaultModel = model || selectedModel || recommendedModel

    // modify assistant tools when experimental on, retieval toggle enabled in default
    const assistantTools: AssistantTool = {
      type: 'retrieval',
      enabled: true,
      settings: assistant.tools && assistant.tools[0].settings,
    }

    // Default context length is 8192
    const contextLength = defaultModel?.settings?.ctx_len
      ? Math.min(8192, defaultModel?.settings?.ctx_len)
      : undefined

    const overriddenSettings = {
      ctx_len: contextLength,
    }

    // Use ctx length by default
    const overriddenParameters = {
      max_tokens: contextLength
        ? Math.min(defaultModel?.parameters?.max_tokens ?? 8192, contextLength)
        : defaultModel?.parameters?.max_tokens,
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
        updated_at: Date.now(),
      },
    }

    // add the new thread on top of the thread list to the state
    try {
      const createdThread = await persistNewThread(thread, assistantInfo)
      if (!createdThread) throw 'Thread created failed.'
      createNewThread(createdThread)

      setSelectedModel(defaultModel)
      setThreadModelParams(createdThread.id, {
        ...defaultModel?.settings,
        ...defaultModel?.parameters,
        ...overriddenSettings,
      })

      // Delete the file upload state
      setFileUpload(undefined)
      setActiveThread(createdThread)
    } catch (ex) {
      return toaster({
        title: 'Thread created failed.',
        description: `Could not create a new thread. Please try again.`,
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

      updateThreadCallback(thread)
      if (thread.assistants && thread.assistants?.length > 0) {
        setActiveAssistant(thread.assistants[0])
        return updateAssistantCallback(thread.id, thread.assistants[0])
      }
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
          .catch(console.error)
        return thread
      })
      .catch(() => undefined)
  }

  return {
    requestCreateNewThread,
    updateThreadMetadata,
  }
}
