import { ChatCompletionRole, ExtensionType } from '@janhq/core'
import { ConversationalExtension } from '@janhq/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { useActiveModel } from './useActiveModel'

import { extensionManager } from '@/extension/ExtensionManager'

import {
  cleanConversationMessages,
  deleteConversationMessage,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  threadsAtom,
  setActiveThreadIdAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function useDeleteThread() {
  const { activeModel } = useActiveModel()
  const [threads, setThreads] = useAtom(threadsAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const setActiveConvoId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteConversationMessage)
  const cleanMessages = useSetAtom(cleanConversationMessages)

  const cleanThread = async (activeThreadId: string) => {
    if (activeThreadId) {
      const thread = threads.filter((c) => c.id === activeThreadId)[0]
      cleanMessages(activeThreadId)
      if (thread)
        await extensionManager
          .get<ConversationalExtension>(ExtensionType.Conversational)
          ?.writeMessages(
            activeThreadId,
            messages.filter((msg) => msg.role === ChatCompletionRole.System)
          )
    }
  }

  const deleteThread = async (activeThreadId: string) => {
    if (!activeThreadId) {
      alert('No active thread')
      return
    }
    try {
      await extensionManager
        .get<ConversationalExtension>(ExtensionType.Conversational)
        ?.deleteThread(activeThreadId)
      const availableThreads = threads.filter((c) => c.id !== activeThreadId)
      setThreads(availableThreads)
      deleteMessages(activeThreadId)
      setCurrentPrompt('')
      toaster({
        title: 'Thread successfully deleted.',
        description: `Thread with ${activeModel?.name} has been successfully deleted.`,
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
