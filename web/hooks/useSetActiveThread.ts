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
  setActiveThreadIdAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useSetActiveThread() {
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setConvoMessagesAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

  const setActiveThread = useCallback(
    async (thread: Thread) => {
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
    [setActiveThreadId, setThreadMessage, setThreadModelParams]
  )

  return { setActiveThread }
}

const getLocalThreadMessage = async (threadId: string) =>
  extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.getAllMessages(threadId) ?? []
