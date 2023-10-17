import { useAtom, useSetAtom } from "jotai"
import { Conversation } from "@/_models/Conversation"
import { executeSerial } from "@/_services/pluginService"
import { DataService, ModelManagementService } from "@janhq/core"
import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
  updateConversationWaitingForResponseAtom,
  updateConversationErrorAtom,
} from '@/_helpers/atoms/Conversation.atom'
import useInitModel from './useInitModel'
import { AssistantModel } from '@/_models/AssistantModel'
import { Bot } from "@/_models/Bot"

const useCreateConversation = () => {
  const { initModel } = useInitModel()
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const addNewConvoState = useSetAtom(addNewConversationStateAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const updateConvError = useSetAtom(updateConversationErrorAtom)

  const createConvoByBot = async (bot: Bot) => {
    const model = await executeSerial(
      ModelManagementService.GetModelById,
      bot.modelId
    )

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

    if (id) updateConvWaiting(id, true)
    initModel(model).then((res: any) => {
      if (id) updateConvWaiting(id, false)
      if (res?.error) {
        updateConvError(id, res.error)
      }
    })

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
