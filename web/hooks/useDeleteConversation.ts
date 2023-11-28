import { ChatCompletionRole, PluginType } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { pluginManager } from '../plugin/PluginManager'

import { useActiveModel } from './useActiveModel'

import {
  cleanConversationMessages,
  deleteConversationMessage,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  threadsAtom,
  getActiveThreadIdAtom,
  setActiveThreadIdAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function useDeleteThread() {
  const { activeModel } = useActiveModel()
  const [threads, setThreads] = useAtom(threadsAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const setActiveConvoId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteConversationMessage)
  const cleanMessages = useSetAtom(cleanConversationMessages)

  const cleanThread = async () => {
    if (activeThreadId) {
      const thread = threads.filter((c) => c.id === activeThreadId)[0]
      cleanMessages(activeThreadId)
      if (thread)
        await pluginManager
          .get<ConversationalPlugin>(PluginType.Conversational)
          ?.writeMessages(
            activeThreadId,
            messages.filter((msg) => msg.role === ChatCompletionRole.System)
          )
    }
  }

  const deleteThread = async () => {
    if (!activeThreadId) {
      alert('No active thread')
      return
    }
    try {
      await pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.deleteThread(activeThreadId)
      const availableThreads = threads.filter((c) => c.id !== activeThreadId)
      setThreads(availableThreads)
      deleteMessages(activeThreadId)
      setCurrentPrompt('')
      toaster({
        title: 'Chat successfully deleted.',
        description: `Chat with ${activeModel?.name} has been successfully deleted.`,
      })
      if (availableThreads.length > 0) {
        setActiveConvoId(availableThreads[0].id)
      } else {
        setActiveConvoId(undefined)
      }
    } catch (err) {
      console.error(err)
    }
  }

  return {
    cleanThread,
    deleteThread,
  }
}
