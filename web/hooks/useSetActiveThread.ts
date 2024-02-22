import { ExtensionTypeEnum, Thread, ConversationalExtension } from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import {
  readyThreadsMessagesAtom,
  setConvoMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  ModelParams,
  setActiveThreadIdAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useSetActiveThread() {
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setConvoMessagesAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const readyMessageThreads = useAtomValue(readyThreadsMessagesAtom)

  const setActiveThread = async (thread: Thread) => {
    // Load local messages only if there are no messages in the state
    if (!readyMessageThreads[thread.id]) {
      const messages = await getLocalThreadMessage(thread.id)
      setThreadMessage(thread.id, messages)
    }

    setActiveThreadId(thread.id)
    const modelParams: ModelParams = {
      ...thread.assistants[0]?.model?.parameters,
      ...thread.assistants[0]?.model?.settings,
    }
    setThreadModelParams(thread.id, modelParams)
  }

  return { setActiveThread }
}

const getLocalThreadMessage = async (threadId: string) =>
  extensionManager
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.getAllMessages(threadId) ?? []
