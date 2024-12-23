import { useCallback } from 'react'

import { ExtensionTypeEnum, ConversationalExtension } from '@janhq/core'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { useCreateNewThread } from './useCreateNewThread'

import { extensionManager } from '@/extension/ExtensionManager'

import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { deleteChatMessageAtom as deleteChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import {
  threadsAtom,
  setActiveThreadIdAtom,
  deleteThreadStateAtom,
  updateThreadAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useDeleteThread() {
  const [threads, setThreads] = useAtom(threadsAtom)
  const updateThread = useSetAtom(updateThreadAtom)

  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteChatMessagesAtom)

  const deleteThreadState = useSetAtom(deleteThreadStateAtom)

  const cleanThread = useCallback(
    async (threadId: string) => {
      const messages = await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.listMessages(threadId)
        .catch(console.error)
      if (messages) {
        messages.forEach((message) => {
          extensionManager
            .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
            ?.deleteMessage(threadId, message.id)
            .catch(console.error)
        })
        const thread = threads.find((e) => e.id === threadId)
        if (thread) {
          const updatedThread = {
            ...thread,
            metadata: {
              ...thread.metadata,
              title: 'New Thread',
              lastMessage: '',
            },
          }
          extensionManager
            .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
            ?.modifyThread(updatedThread)
            .catch(console.error)
          updateThread(updatedThread)
        }
      }
      deleteMessages(threadId)
    },
    [deleteMessages, threads, updateThread]
  )

  const deleteThread = async (threadId: string) => {
    if (!threadId) {
      alert('No active thread')
      return
    }
    await extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.deleteThread(threadId)
      .catch(console.error)
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
  }

  return {
    cleanThread,
    deleteThread,
  }
}
