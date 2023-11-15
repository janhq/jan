import { PluginType } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { Conversation } from '@janhq/core/lib/types'
import { useSetAtom } from 'jotai'

import { setConvoMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  conversationStatesAtom,
  userConversationsAtom,
} from '@/helpers/atoms/Conversation.atom'
import { toChatMessage } from '@/models/ChatMessage'
import { pluginManager } from '@/plugin/PluginManager'
import { ChatMessage, ConversationState } from '@/types/chatMessage'

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
        convoStates[convo._id ?? ''] = {
          hasMore: true,
          waitingForResponse: false,
        }
        setConvoMessages(
          convo.messages.map<ChatMessage>((msg) => toChatMessage(msg)),
          convo._id ?? ''
        )
      })
      setConversationStates(convoStates)
      setConversations(convos ?? [])
    } catch (error) {
      console.log(error)
    }
  }

  return {
    getUserConversations,
  }
}

export default useGetUserConversations
