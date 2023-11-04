import { useSetAtom } from 'jotai'
import {
  conversationStatesAtom,
  userConversationsAtom,
} from '@helpers/atoms/Conversation.atom'
import { pluginManager } from '../plugin/PluginManager'
import { PluginType } from '@janhq/core'
import { setConvoMessagesAtom } from '@helpers/atoms/ChatMessage.atom'
import { toChatMessage } from '@models/ChatMessage'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { Conversation } from "@janhq/core/lib/types"

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
    } catch (ex) {
      console.log(ex)
    }
  }

  return {
    getUserConversations,
  }
}

export default useGetUserConversations
