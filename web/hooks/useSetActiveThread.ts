import { useCallback } from 'react'

import { Thread } from '@janhq/core'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { setThreadMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  ModelParams,
  setActiveThreadIdAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useSetActiveThread() {
  const setActiveThreadId = useSetAtom(setActiveThreadIdAtom)
  const setThreadMessage = useSetAtom(setThreadMessagesAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const { fetchMessages } = useCortex()

  const setActiveThread = useCallback(
    async (thread: Thread) => {
      const messages = await fetchMessages(thread.id)
      setThreadMessage(thread.id, messages)

      setActiveThreadId(thread.id)
      const modelParams: ModelParams = {
        ...thread?.assistants[0]?.model?.parameters,
        ...thread?.assistants[0]?.model?.settings,
      }
      setThreadModelParams(thread?.id, modelParams)
    },
    [fetchMessages, setThreadMessage, setActiveThreadId, setThreadModelParams]
  )

  return { setActiveThread }
}
