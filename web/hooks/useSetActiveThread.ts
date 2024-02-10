import { useCallback } from 'react'

import {
  InferenceEvent,
  ExtensionTypeEnum,
  Thread,
  events,
  ConversationalExtension,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  ModelParams,
  isGeneratingResponseAtom,
  setActiveThreadIdAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useSetActiveThread() {
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setConvoMessagesAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)

  const setActiveThread = useCallback(
    async (thread: Thread) => {
      setIsGeneratingResponse(false)
      events.emit(InferenceEvent.OnInferenceStopped, thread.id)

      // load the corresponding messages
      const messages = await getLocalThreadMessage(thread.id)
      setThreadMessage(thread.id, messages)

      setActiveThreadId(thread.id)
      const modelParams: ModelParams = {
        ...thread.assistants[0]?.model?.parameters,
        ...thread.assistants[0]?.model?.settings,
      }
      setThreadModelParams(thread.id, modelParams)
    },
    [
      setActiveThreadId,
      setThreadMessage,
      setThreadModelParams,
      setIsGeneratingResponse,
    ]
  )

  return { setActiveThread }
}

const getLocalThreadMessage = async (threadId: string) =>
  extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.getAllMessages(threadId) ?? []
