import {
  ChatCompletionRole,
  ExtensionType,
  ConversationalExtension,
} from '@janhq/core'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension/ExtensionManager'

import {
  cleanChatMessageAtom as cleanChatMessagesAtom,
  deleteChatMessageAtom as deleteChatMessagesAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  threadsAtom,
  setActiveThreadIdAtom,
  deleteThreadStateAtom,
  threadStatesAtom,
  updateThreadStateLastMessageAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useDeleteThread() {
  const [threads, setThreads] = useAtom(threadsAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteChatMessagesAtom)
  const cleanMessages = useSetAtom(cleanChatMessagesAtom)
  const deleteThreadState = useSetAtom(deleteThreadStateAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const updateThreadLastMessage = useSetAtom(updateThreadStateLastMessageAtom)

  const cleanThread = async (threadId: string) => {
    if (threadId) {
      const thread = threads.filter((c) => c.id === threadId)[0]
      cleanMessages(threadId)

      if (thread) {
        await extensionManager
          .get<ConversationalExtension>(ExtensionType.Conversational)
          ?.writeMessages(
            threadId,
            messages.filter((msg) => msg.role === ChatCompletionRole.System)
          )
        updateThreadLastMessage(threadId, undefined)
      }
    }
  }

  const deleteThread = async (threadId: string) => {
    if (!threadId) {
      alert('No active thread')
      return
    }
    try {
      await extensionManager
        .get<ConversationalExtension>(ExtensionType.Conversational)
        ?.deleteThread(threadId)
      const availableThreads = threads.filter((c) => c.id !== threadId)
      setThreads(availableThreads)

      const deletingThreadState = threadStates[threadId]
      const isFinishInit = deletingThreadState?.isFinishInit ?? true

      // delete the thread state
      deleteThreadState(threadId)

      if (isFinishInit) {
        deleteMessages(threadId)
        setCurrentPrompt('')
        toaster({
          title: 'Thread successfully deleted.',
          description: `Thread ${threadId} has been successfully deleted.`,
        })
      }

      if (availableThreads.length > 0) {
        setActiveThreadId(availableThreads[0].id)
      } else {
        setActiveThreadId(undefined)
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
