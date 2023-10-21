import { addNewMessageAtom, updateMessageAtom } from './atoms/ChatMessage.atom'
import { toChatMessage } from '@models/ChatMessage'
import { events, EventName, NewMessageResponse } from '@janhq/core'
import { useSetAtom } from 'jotai'
import { ReactNode, useEffect } from 'react'

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)

  function handleNewMessageResponse(message: NewMessageResponse) {
    const newResponse = toChatMessage(message)
    addNewMessage(newResponse)
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
  return <> {children}</>
}
