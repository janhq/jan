import { addNewMessageAtom, updateMessageAtom } from './atoms/ChatMessage.atom'
import { toChatMessage } from '@models/ChatMessage'
import { events, EventName, NewMessageResponse, DataService } from '@janhq/core'
import { useSetAtom } from 'jotai'
import { ReactNode, useEffect } from 'react'
import useGetBots from '@hooks/useGetBots'
import useGetUserConversations from '@hooks/useGetUserConversations'
import {
  updateConversationAtom,
  updateConversationWaitingForResponseAtom,
} from './atoms/Conversation.atom'
import { executeSerial } from '../../electron/core/plugin-manager/execution/extension-manager'
import { debounce } from 'lodash'

let currentConversation: Conversation | undefined = undefined

const debouncedUpdateConversation = debounce(
  async (updatedConv: Conversation) => {
    await executeSerial(DataService.UpdateConversation, updatedConv)
  },
  1000
)

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)
  const { getBotById } = useGetBots()
  const { getConversationById } = useGetUserConversations()

  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)

  async function handleNewMessageResponse(message: NewMessageResponse) {
    if (message.conversationId) {
      const convo = await getConversationById(message.conversationId)
      const botId = convo?.botId
      console.debug('botId', botId)
      if (botId) {
        const bot = await getBotById(botId)
        const newResponse = toChatMessage(message, bot)
        addNewMessage(newResponse)
      } else {
        const newResponse = toChatMessage(message)
        addNewMessage(newResponse)
      }
    }
  }
  async function handleMessageResponseUpdate(
    messageResponse: NewMessageResponse
  ) {
    if (
      messageResponse.conversationId &&
      messageResponse._id &&
      messageResponse.message
    ) {
      updateMessage(
        messageResponse._id,
        messageResponse.conversationId,
        messageResponse.message
      )
    }

    if (messageResponse.conversationId) {
      if (
        !currentConversation ||
        currentConversation._id !== messageResponse.conversationId
      ) {
        currentConversation = await getConversationById(
          messageResponse.conversationId
        )
      }

      const updatedConv: Conversation = {
        ...currentConversation,
        lastMessage: messageResponse.message,
      }

      updateConversation(updatedConv)
      debouncedUpdateConversation(updatedConv)
    }
  }

  async function handleMessageResponseFinished(
    messageResponse: NewMessageResponse
  ) {
    if (!messageResponse.conversationId) return
    console.debug('handleMessageResponseFinished', messageResponse)
    updateConvWaiting(messageResponse.conversationId, false)
  }

  useEffect(() => {
    if (window.corePlugin.events) {
      events.on(EventName.OnNewMessageResponse, handleNewMessageResponse)
      events.on(EventName.OnMessageResponseUpdate, handleMessageResponseUpdate)
      events.on(
        "OnMessageResponseFinished",
        // EventName.OnMessageResponseFinished,
        handleMessageResponseFinished
      )
    }
  }, [])

  useEffect(() => {
    return () => {
      events.off(EventName.OnNewMessageResponse, handleNewMessageResponse)
      events.off(EventName.OnMessageResponseUpdate, handleMessageResponseUpdate)
      events.off(
        "OnMessageResponseFinished",
        // EventName.OnMessageResponseFinished,
        handleMessageResponseFinished
      )
    }
  }, [])
  return <>{children}</>
}
