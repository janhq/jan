import { ExtensionTypeEnum, Thread, ConversationalExtension } from '@janhq/core'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import {
  setConvoMessagesAtom,
  subscribedGeneratingMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  getActiveThreadIdAtom,
  setActiveThreadIdAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'
import { ModelParams } from '@/types/model'

export default function useSetActiveThread() {
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const setThreadMessages = useSetAtom(setConvoMessagesAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const setActiveAssistant = useSetAtom(activeAssistantAtom)
  const [messageSubscriber, setMessageSubscriber] = useAtom(
    subscribedGeneratingMessageAtom
  )

  const setActiveThread = async (thread: Thread) => {
    if (!thread?.id || activeThreadId === thread.id) return

    setActiveThreadId(thread.id)

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
      setThreadMessages(thread.id, messages)
      if (messageSubscriber.thread_id !== thread.id) setMessageSubscriber({})
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
