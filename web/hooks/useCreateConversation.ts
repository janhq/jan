import { useAtom, useSetAtom } from 'jotai'
import { executeSerial } from '@services/pluginService'
import { DataService, ModelManagementService } from '@janhq/core'
import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
} from '@helpers/atoms/Conversation.atom'
import useGetModelById from './useGetModelById'

const useCreateConversation = () => {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const { getModelById } = useGetModelById()
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const addNewConvoState = useSetAtom(addNewConversationStateAtom)

  const createConvoByBot = async (bot: Bot) => {
    const model = await getModelById(bot.modelId)

    if (!model) {
      alert(
        `Model ${bot.modelId} not found! Please re-download the model first.`
      )
      return
    }

    return requestCreateConvo(model, bot)
  }

  const requestCreateConvo = async (model: AssistantModel, bot?: Bot) => {
    const conversationName = model.name
    const mappedConvo: Conversation = {
      _id: `conversation-${Date.now()}`,
      modelId: model._id,
      name: conversationName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      botId: bot?._id ?? undefined,
    }

    addNewConvoState(mappedConvo._id, {
      hasMore: true,
      waitingForResponse: false,
    })
    setUserConversations([mappedConvo, ...userConversations])
    setActiveConvoId(mappedConvo._id)
  }

  return {
    createConvoByBot,
    requestCreateConvo,
  }
}

export default useCreateConversation
