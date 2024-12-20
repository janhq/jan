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
} from '@/helpers/atoms/Thread.atom'

export default function useDeleteThread() {
  const [threads, setThreads] = useAtom(threadsAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const assistants = useAtomValue(assistantsAtom)
  const models = useAtomValue(downloadedModelsAtom)

  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const deleteMessages = useSetAtom(deleteChatMessagesAtom)

  const deleteThreadState = useSetAtom(deleteThreadStateAtom)

  const cleanThread = useCallback(
    async (threadId: string) => {
      const thread = threads.find((c) => c.id === threadId)
      if (!thread) return
      const availableThreads = threads.filter((c) => c.id !== threadId)
      setThreads(availableThreads)

      // delete the thread state
      deleteThreadState(threadId)

      const assistantInfo = await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.getThreadAssistant(thread.id)
        .catch(console.error)

      if (!assistantInfo) return
      const model = models.find((c) => c.id === assistantInfo?.model?.id)

      requestCreateNewThread(
        {
          ...assistantInfo,
          id: assistants[0].id,
          name: assistants[0].name,
        },
        model
          ? {
              ...model,
              parameters: assistantInfo?.model?.parameters ?? {},
              settings: assistantInfo?.model?.settings ?? {},
            }
          : undefined
      )
      // Delete this thread
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.deleteThread(threadId)
        .catch(console.error)
    },
    [assistants, models, requestCreateNewThread, threads]
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
