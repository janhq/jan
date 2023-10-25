import { toChatMessage } from '@models/ChatMessage'
import { executeSerial } from '@services/pluginService'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { DataService } from '@janhq/core'
import { getActiveConvoIdAtom } from '@helpers/atoms/Conversation.atom'
import {
  getCurrentChatMessagesAtom,
  setCurrentChatMessagesAtom,
} from '@helpers/atoms/ChatMessage.atom'

/**
 * Custom hooks to get chat messages for current(active) conversation
 */
const useChatMessages = () => {
  const setMessages = useSetAtom(setCurrentChatMessagesAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)

  const getMessages = async (convoId: string) => {
    const data: any = await executeSerial(
      DataService.GetConversationMessages,
      convoId
    )
    if (!data) {
      return []
    }

    return parseMessages(data)
  }

  useEffect(() => {
    if (!activeConvoId) {
      console.error('active convo is undefined')
      return
    }

    getMessages(activeConvoId)
      .then((messages) => {
        setMessages(messages)
      })
      .catch((err) => {
        console.error(err)
      })
  }, [activeConvoId])

  return { messages }
}

function parseMessages(messages: RawMessage[]): ChatMessage[] {
  const newMessages: ChatMessage[] = []
  for (const m of messages) {
    const chatMessage = toChatMessage(m)
    newMessages.push(chatMessage)
  }
  return newMessages
}

export default useChatMessages
