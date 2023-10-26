import { toChatMessage } from '@models/ChatMessage'
import { executeSerial } from '@services/pluginService'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { DataService } from '@janhq/core'
import {
  getActiveConvoIdAtom,
  userConversationsAtom,
} from '@helpers/atoms/Conversation.atom'
import {
  getCurrentChatMessagesAtom,
  setCurrentChatMessagesAtom,
} from '@helpers/atoms/ChatMessage.atom'
import useGetBots from './useGetBots'

/**
 * Custom hooks to get chat messages for current(active) conversation
 */
const useChatMessages = () => {
  const setMessages = useSetAtom(setCurrentChatMessagesAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const userConversations = useAtomValue(userConversationsAtom)
  const { getBotById } = useGetBots()

  const getMessages = async (convoId: string) => {
    const data: any = await executeSerial(
      DataService.GetConversationMessages,
      convoId
    )
    if (!data) {
      return []
    }

    const convo = userConversations.find((c) => c._id === convoId)
    if (convo && convo.botId) {
      const bot = await getBotById(convo.botId)
      return parseMessages(data, bot)
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

function parseMessages(messages: RawMessage[], bot?: Bot): ChatMessage[] {
  const newMessages: ChatMessage[] = []
  for (const m of messages) {
    const chatMessage = toChatMessage(m, bot)
    newMessages.push(chatMessage)
  }
  return newMessages
}

export default useChatMessages
