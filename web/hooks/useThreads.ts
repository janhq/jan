import { useCallback } from 'react'

import { Assistant } from '@janhq/core'
import log from 'electron-log/renderer'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import {
  cleanChatMessageAtom,
  deleteChatMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'

import { setThreadMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  deleteThreadAtom,
  setActiveThreadIdAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

const useThreads = () => {
  const setThreads = useSetAtom(threadsAtom)
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setThreadMessagesAtom)
  const deleteMessages = useSetAtom(deleteChatMessageAtom)
  const deleteThreadState = useSetAtom(deleteThreadAtom)
  const cleanMessages = useSetAtom(cleanChatMessageAtom)
  const {
    createThread,
    fetchMessages,
    deleteThread: deleteCortexThread,
    cleanThread: cleanCortexThread,
  } = useCortex()

  const setActiveThread = useCallback(
    async (threadId: string) => {
      const messages = await fetchMessages(threadId)
      setThreadMessage(threadId, messages)
      setActiveThreadId(threadId)
    },
    [fetchMessages, setThreadMessage, setActiveThreadId]
  )

  const createNewThread = useCallback(
    async (modelId: string, assistant: Assistant, instructions?: string) => {
      assistant.model = modelId
      if (instructions) {
        assistant.instructions = instructions
      }
      const thread = await createThread(assistant)
      log.info('Create new thread result', thread)
      setThreads((threads) => [thread, ...threads])
      setActiveThread(thread.id)
      return thread
    },
    [createThread, setActiveThread, setThreads]
  )

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await deleteCortexThread(threadId)
        deleteThreadState(threadId)
        deleteMessages(threadId)
      } catch (err) {
        console.error(err)
      }
    },
    [deleteMessages, deleteCortexThread, deleteThreadState]
  )

  const cleanThread = useCallback(
    async (threadId: string) => {
      await cleanCortexThread(threadId)
      cleanMessages(threadId)
    },
    [cleanCortexThread, cleanMessages]
  )

  return {
    createThread: createNewThread,
    setActiveThread,
    deleteThread,
    cleanThread,
  }
}

export default useThreads
