import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useGetModelById } from './useGetModelById'
import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
} from '@/helpers/atoms/Conversation.atom'
import { Model } from '@janhq/core/lib/types'
import { downloadedModelAtom } from '@helpers/atoms/DownloadedModel.atom'
import { generateConversationId } from '@utils/conversation'

const useCreateConversation = () => {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  )
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const addNewConvoState = useSetAtom(addNewConversationStateAtom)
  const models = useAtomValue(downloadedModelAtom)

  const createConvoByBot = async (bot: Bot) => {
    const model = models.find((e) => e._id === bot.modelId)

    if (!model) {
      alert(
        `Model ${bot.modelId} not found! Please re-download the model first.`
      )
      return
    }

    return requestCreateConvo(model, bot)
  }

  const requestCreateConvo = async (model: Model, bot?: Bot) => {
    const conversationName = model.name
    const mappedConvo: Conversation = {
      _id: generateConversationId(),
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
