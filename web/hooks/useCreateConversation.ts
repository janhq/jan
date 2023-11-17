import { PluginType } from '@janhq/core'
import { Thread, Model } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { useAtom, useSetAtom } from 'jotai'

import { generateConversationId } from '@/utils/conversation'

import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin'

export const useCreateConversation = () => {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const addNewConvoState = useSetAtom(addNewConversationStateAtom)

  const requestCreateConvo = async (model: Model) => {
    const mappedConvo: Thread = {
      id: generateConversationId(),
      modelId: model.id,
      summary: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    }

    addNewConvoState(mappedConvo.id, {
      hasMore: true,
      waitingForResponse: false,
    })

    await pluginManager
      .get<ConversationalPlugin>(PluginType.Conversational)
      ?.saveConversation(mappedConvo)
    setUserConversations([mappedConvo, ...userConversations])
    setActiveConvoId(mappedConvo.id)
  }

  return {
    requestCreateConvo,
  }
}
