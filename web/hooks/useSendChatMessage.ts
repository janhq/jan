import { currentPromptAtom } from '@helpers/JotaiWrapper'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  DataService,
  EventName,
  InferenceService,
  events,
  store,
} from '@janhq/core'
import { toChatMessage } from '@models/ChatMessage'
import { executeSerial } from '@services/pluginService'
import { addNewMessageAtom } from '@helpers/atoms/ChatMessage.atom'
import {
  currentConversationAtom,
  updateConversationAtom,
  updateConversationWaitingForResponseAtom,
} from '@helpers/atoms/Conversation.atom'

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)

  let timeout: any | undefined = undefined

  function updateConvSummary(newMessage: any) {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      const conv = currentConvo
      if (
        !currentConvo?.summary ||
        currentConvo.summary === '' ||
        currentConvo.summary.startsWith('Prompt:')
      ) {
        // Request convo summary
        setTimeout(async () => {
          newMessage.message =
            'summary this conversation in 5 words, the response should just include the summary'
          const result = await executeSerial(
            InferenceService.InferenceRequest,
            newMessage
          )

          if (
            result?.message &&
            result.message.split(' ').length <= 10 &&
            conv?._id
          ) {
            const updatedConv = {
              ...conv,
              summary: result.message,
            }
            updateConversation(updatedConv)
            await executeSerial(DataService.UpdateConversation, updatedConv)
          }
        }, 1000)
      }
    }, 100)
  }

  const sendChatMessage = async () => {
    const convoId = currentConvo?._id

    if (!convoId) return
    setCurrentPrompt('')
    updateConvWaiting(convoId, true)

    const prompt = currentPrompt.trim()
    const newMessage: RawMessage = {
      conversationId: convoId,
      message: prompt,
      user: 'user',
      createdAt: new Date().toISOString(),
    }
    const id = await executeSerial(DataService.CreateMessage, newMessage)
    newMessage._id = id

    const newChatMessage = toChatMessage(newMessage)
    addNewMessage(newChatMessage)

    events.emit(EventName.OnNewMessageRequest, newMessage)

    if (!currentConvo?.summary && currentConvo) {
      const updatedConv: Conversation = {
        ...currentConvo,
        lastMessage: prompt,
        summary: `Prompt: ${prompt}`,
      }

      updateConversation(updatedConv)
      await executeSerial(DataService.UpdateConversation, updatedConv)
    } else {
      const updatedConv: Conversation = {
        ...currentConvo,
        lastMessage: prompt,
      }

      updateConversation(updatedConv)
      await executeSerial(DataService.UpdateConversation, updatedConv)
    }

    updateConvSummary(newMessage)
  }

  return {
    sendChatMessage,
  }
}
