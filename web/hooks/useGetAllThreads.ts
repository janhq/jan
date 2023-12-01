import { ExtensionType, ThreadState } from '@janhq/core'
import { ConversationalExtension } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Conversation.atom'

const useGetAllThreads = () => {
  const setConversationStates = useSetAtom(threadStatesAtom)
  const setConversations = useSetAtom(threadsAtom)

  const getAllThreads = async () => {
    try {
      const threads = await extensionManager
        .get<ConversationalExtension>(ExtensionType.Conversational)
        ?.getThreads()
      const threadStates: Record<string, ThreadState> = {}
      threads?.forEach((thread) => {
        if (thread.id != null) {
          const lastMessage = (thread.metadata?.lastMessage as string) ?? ''
          threadStates[thread.id] = {
            hasMore: true,
            waitingForResponse: false,
            lastMessage,
          }
        }
      })
      setConversationStates(threadStates)
      setConversations(threads ?? [])
    } catch (error) {
      console.error(error)
    }
  }

  return {
    getAllThreads,
  }
}

export default useGetAllThreads
