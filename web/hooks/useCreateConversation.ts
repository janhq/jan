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

  const requestCreateConvo = async (model: AssistantModel, bot?: Bot) => {
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
    requestCreateConvo,
  }
}

export default useCreateConversation
