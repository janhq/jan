import { PluginType, Thread } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useSetAtom } from 'jotai'

import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  conversationStatesAtom,
  userConversationsAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin/PluginManager'
import { ThreadState } from '@/types/conversation'

const useGetUserConversations = () => {
  const setConversationStates = useSetAtom(conversationStatesAtom)
  const setConversations = useSetAtom(userConversationsAtom)
  const setConvoMessages = useSetAtom(setConvoMessagesAtom)

  const getUserConversations = async () => {
    try {
      const convos: Thread[] | undefined = await pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.getConversations()
      const convoStates: Record<string, ThreadState> = {}
      convos?.forEach((convo) => {
        convoStates[convo.id ?? ''] = {
          hasMore: true,
          waitingForResponse: false,
          lastMessage: convo.messages[0]?.content ?? '',
        }
        setConvoMessages(convo.messages, convo.id ?? '')
      })
      setConversationStates(convoStates)
      setConversations(convos ?? [])
    } catch (error) {
      console.error(error)
    }
  }

  return {
    getUserConversations,
  }
}

export default useGetUserConversations
