import { addNewMessageAtom, updateMessageAtom } from './atoms/ChatMessage.atom'
import { toChatMessage } from '@models/ChatMessage'
import { events, EventName, NewMessageResponse } from '@janhq/core'
import { useSetAtom } from 'jotai'
import { ReactNode, useEffect } from 'react'
import useGetBots from '@hooks/useGetBots'
import useGetUserConversations from '@hooks/useGetUserConversations'

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const { getBotById } = useGetBots()
  const { getConversationById } = useGetUserConversations()

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
    )
      updateMessage(
        messageResponse._id,
        messageResponse.conversationId,
        messageResponse.message
      )
  }

  useEffect(() => {
    if (window.corePlugin.events) {
      events.on(EventName.OnNewMessageResponse, handleNewMessageResponse)
      events.on(EventName.OnMessageResponseUpdate, handleMessageResponseUpdate)
    }
  }, [])

  useEffect(() => {
    return () => {
      events.off(EventName.OnNewMessageResponse, handleNewMessageResponse)
      events.off(EventName.OnMessageResponseUpdate, handleMessageResponseUpdate)
    }
  }, [])
  return <>{children}</>
}
