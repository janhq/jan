import {
  EventName,
  ExtensionType,
  Thread,
  events,
  ConversationalExtension,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  getActiveThreadIdAtom,
  setActiveThreadIdAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useSetActiveThread() {
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setConvoMessagesAtom)

  const setActiveThread = async (thread: Thread) => {
    if (activeThreadId === thread.id) {
      console.debug('Thread already active')
      return
    }

    events.emit(EventName.OnInferenceStopped, thread.id)

    // load the corresponding messages
    const messages = await extensionManager
      .get<ConversationalExtension>(ExtensionType.Conversational)
      ?.getAllMessages(thread.id)
    setThreadMessage(thread.id, messages ?? [])

    setActiveThreadId(thread.id)
  }

  return { activeThreadId, setActiveThread }
}
