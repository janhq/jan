import { useCallback } from 'react'

import {
  ChatCompletionRole,
  ExtensionTypeEnum,
  ConversationalExtension,
  fs,
  joinPath,
} from '@janhq/core'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension/ExtensionManager'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  chatMessages,
  cleanChatMessageAtom as cleanChatMessagesAtom,
  deleteChatMessageAtom as deleteChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  threadsAtom,
  setActiveThreadIdAtom,
  deleteThreadStateAtom,
  updateThreadStateLastMessageAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useDeleteThread() {
  const [threads, setThreads] = useAtom(threadsAtom)
  const messages = useAtomValue(chatMessages)
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)

  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteChatMessagesAtom)
  const cleanMessages = useSetAtom(cleanChatMessagesAtom)

  const deleteThreadState = useSetAtom(deleteThreadStateAtom)
  const updateThreadLastMessage = useSetAtom(updateThreadStateLastMessageAtom)

  const cleanThread = useCallback(
    async (threadId: string) => {
      cleanMessages(threadId)
      const thread = threads.find((c) => c.id === threadId)
      if (!thread) return

      const updatedMessages = (messages[threadId] ?? []).filter(
        (msg) => msg.role === ChatCompletionRole.System
      )

      // remove files
      try {
        const threadFolderPath = await joinPath([
          janDataFolderPath,
          'threads',
          threadId,
        ])
        const threadFilesPath = await joinPath([threadFolderPath, 'files'])
        const threadMemoryPath = await joinPath([threadFolderPath, 'memory'])
        await fs.rm(threadFilesPath)
        await fs.rm(threadMemoryPath)
      } catch (err) {
        console.warn('Error deleting thread files', err)
      }

      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.writeMessages(threadId, updatedMessages)

      thread.metadata = {
        ...thread.metadata,
        lastMessage: undefined,
      }
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.saveThread(thread)
      updateThreadLastMessage(threadId, undefined)
    },
    [
      janDataFolderPath,
      threads,
      messages,
      cleanMessages,
      updateThreadLastMessage,
    ]
  )

  const deleteThread = async (threadId: string) => {
    if (!threadId) {
      alert('No active thread')
      return
    }
    try {
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.deleteThread(threadId)
      const availableThreads = threads.filter((c) => c.id !== threadId)
      setThreads(availableThreads)

      // delete the thread state
      deleteThreadState(threadId)

      deleteMessages(threadId)
      setCurrentPrompt('')
      toaster({
        title: 'Thread successfully deleted.',
        description: `Thread ${threadId} has been successfully deleted.`,
        type: 'success',
      })
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
