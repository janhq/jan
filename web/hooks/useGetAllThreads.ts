import { PluginType, ThreadState } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useSetAtom } from 'jotai'

import {
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin/PluginManager'

const useGetAllThreads = () => {
  const setConversationStates = useSetAtom(threadStatesAtom)
  const setConversations = useSetAtom(threadsAtom)

  const getAllThreads = async () => {
    try {
      const threads = await pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
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
