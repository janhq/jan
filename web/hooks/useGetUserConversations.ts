import { PluginType, ChatMessage, ConversationState } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { Conversation } from '@janhq/core/lib/types'
import { useSetAtom } from 'jotai'

import { toChatMessage } from '@/utils/message'

import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  conversationStatesAtom,
  userConversationsAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin/PluginManager'

const useGetUserConversations = () => {
  const setConversationStates = useSetAtom(conversationStatesAtom)
  const setConversations = useSetAtom(userConversationsAtom)
  const setConvoMessages = useSetAtom(setConvoMessagesAtom)

  const getUserConversations = async () => {
    try {
      const convos: Conversation[] | undefined = await pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.getConversations()
      const convoStates: Record<string, ConversationState> = {}
      convos?.forEach((convo) => {
        convoStates[convo.id ?? ''] = {
          hasMore: true,
          waitingForResponse: false,
        }
        setConvoMessages(
          convo.messages.map<ChatMessage>((msg) => toChatMessage(msg)),
          convo.id ?? ''
        )
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
