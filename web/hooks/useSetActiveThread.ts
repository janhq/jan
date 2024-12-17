import { ExtensionTypeEnum, Thread, ConversationalExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  setActiveThreadIdAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'
import { ModelParams } from '@/types/model'

export default function useSetActiveThread() {
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setConvoMessagesAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const setActiveAssistant = useSetAtom(activeAssistantAtom)

  const setActiveThread = async (thread: Thread) => {
    if (!thread?.id) return

    setActiveThreadId(thread?.id)

    try {
      const assistantInfo = await getThreadAssistant(thread.id)
      setActiveAssistant(assistantInfo)
      // Load local messages only if there are no messages in the state
      const messages = await getLocalThreadMessage(thread.id).catch(() => [])
      const modelParams: ModelParams = {
        ...assistantInfo?.model?.parameters,
        ...assistantInfo?.model?.settings,
      }
      setThreadModelParams(thread?.id, modelParams)
      setThreadMessage(thread.id, messages)
    } catch (e) {
      console.error(e)
    }
  }

  return { setActiveThread }
}

const getLocalThreadMessage = async (threadId: string) =>
  extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.listMessages(threadId) ?? []

const getThreadAssistant = async (threadId: string) =>
  extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.getThreadAssistant(threadId)
