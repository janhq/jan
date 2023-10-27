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
    const conv: Conversation = {
      modelId: model._id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: conversationName,
      botId: bot?._id ?? undefined,
    }
    const id = await executeSerial(DataService.CreateConversation, conv)

    const mappedConvo: Conversation = {
      _id: id,
      modelId: model._id,
      name: conversationName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      botId: bot?._id ?? undefined,
    }

    addNewConvoState(id ?? '', {
      hasMore: true,
      waitingForResponse: false,
    })
    setUserConversations([mappedConvo, ...userConversations])
    setActiveConvoId(id)
  }

  return {
    createConvoByBot,
    requestCreateConvo,
  }
}

export default useCreateConversation
