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
} from '@helpers/atoms/Conversation.atom'

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)

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
        currentConvo.summary.startsWith('User request:')
      ) {
        // Request convo summary
        setTimeout(async () => {
          newMessage.message = 'summary this conversation in 5 words'
          const result = await executeSerial(
            InferenceService.InferenceRequest,
            newMessage
          )
          if (
            result?.message &&
            result.message.split(' ').length <= 7 &&
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
    setCurrentPrompt('')
    const prompt = currentPrompt.trim()
    const newMessage: RawMessage = {
      conversationId: currentConvo?._id,
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
      const updatedConv = {
        ...currentConvo,
        summary: `Prompt: ${prompt}`,
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
