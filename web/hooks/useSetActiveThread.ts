import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  getActiveThreadIdAtom,
  setActiveThreadIdAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin'
import { PluginType, Thread } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useAtomValue, useSetAtom } from 'jotai'

export default function useSetActiveThread() {
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setConvoMessagesAtom)

  const setActiveThread = async (thread: Thread) => {
    if (activeThreadId === thread.id) {
      console.debug('Thread already active')
      return
    }

    if (!thread.isFinishInit) {
      console.debug('Thread not finish init')
      return
    }

    // load the corresponding messages
    const messages = await pluginManager
      .get<ConversationalPlugin>(PluginType.Conversational)
      ?.getAllMessages(thread.id)
    setThreadMessage(thread.id, messages ?? [])

    setActiveThreadId(thread.id)
  }

  return { activeThreadId, setActiveThread }
}
