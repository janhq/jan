import { useCallback } from 'react'

import { useAtom, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import useCortex from './useCortex'

import {
  cleanChatMessageAtom as cleanChatMessagesAtom,
  deleteChatMessageAtom as deleteChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { setActiveThreadIdAtom, threadsAtom } from '@/helpers/atoms/Thread.atom'

export default function useDeleteThread() {
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const deleteMessages = useSetAtom(deleteChatMessagesAtom)
  const cleanMessages = useSetAtom(cleanChatMessagesAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)

  const { cleanThread: cleanCortexThread, deleteThread: deleteCortexThread } =
    useCortex()
  const [threads, setThreads] = useAtom(threadsAtom)

  const cleanThread = useCallback(
    async (threadId: string) => {
      await cleanCortexThread(threadId)
      cleanMessages(threadId)
    },
    [cleanCortexThread, cleanMessages]
  )

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        const beingDeletedThread = threads.find((c) => c.id === threadId)
        await deleteCortexThread(threadId)

        // update app state
        const availableThreads = threads.filter((c) => c.id !== threadId)
        setThreads(availableThreads)
        deleteMessages(threadId)
        setCurrentPrompt('')

        if (availableThreads.length > 0) {
          setActiveThreadId(availableThreads[0].id)
        } else {
          setActiveThreadId(undefined)
        }

        toaster({
          title: 'Thread successfully deleted.',
          description: `Thread ${beingDeletedThread?.title ?? threadId} has been successfully deleted.`,
          type: 'success',
        })
      } catch (err) {
        console.error(err)
      }
    },
    [
      setThreads,
      deleteMessages,
      setCurrentPrompt,
      setActiveThreadId,
      deleteCortexThread,
      threads,
    ]
  )

  return {
    cleanThread,
    deleteThread,
  }
}
