import { ChatCompletionRole, MessageStatus, ThreadMessage } from '@janhq/core'
import { atom } from 'jotai'

import {
  conversationStatesAtom,
  currentConversationAtom,
  getActiveConvoIdAtom,
  updateThreadStateLastMessageAtom,
} from './Conversation.atom'

/**
 * Stores all chat messages for all conversations
 */
export const chatMessages = atom<Record<string, ThreadMessage[]>>({})

/**
 * Return the chat messages for the current active conversation
 */
export const getCurrentChatMessagesAtom = atom<ThreadMessage[]>((get) => {
  const activeConversationId = get(getActiveConvoIdAtom)
  if (!activeConversationId) return []
  const messages = get(chatMessages)[activeConversationId]
  return messages ?? []
})

export const setCurrentChatMessagesAtom = atom(
  null,
  (get, set, messages: ThreadMessage[]) => {
    const currentConvoId = get(getActiveConvoIdAtom)
    if (!currentConvoId) return

    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[currentConvoId] = messages
    set(chatMessages, newData)
  }
)

export const setConvoMessagesAtom = atom(
  null,
  (get, set, messages: ThreadMessage[], convoId: string) => {
    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[convoId] = messages
    set(chatMessages, newData)
  }
)

/**
 * Used for pagination. Add old messages to the current conversation
 */
export const addOldMessagesAtom = atom(
  null,
  (get, set, newMessages: ThreadMessage[]) => {
    const currentConvoId = get(getActiveConvoIdAtom)
    if (!currentConvoId) return

    const currentMessages = get(chatMessages)[currentConvoId] ?? []
    const updatedMessages = [...currentMessages, ...newMessages]

    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[currentConvoId] = updatedMessages
    set(chatMessages, newData)
  }
)

export const addNewMessageAtom = atom(
  null,
  (get, set, newMessage: ThreadMessage) => {
    const currentConvoId = get(getActiveConvoIdAtom)
    if (!currentConvoId) return

    const currentMessages = get(chatMessages)[currentConvoId] ?? []
    const updatedMessages = [newMessage, ...currentMessages]

    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[currentConvoId] = updatedMessages
    set(chatMessages, newData)
    // Update thread last message
    set(updateThreadStateLastMessageAtom, currentConvoId, newMessage.content)
  }
)

export const deleteConversationMessage = atom(null, (get, set, id: string) => {
  const newData: Record<string, ThreadMessage[]> = {
    ...get(chatMessages),
  }
  newData[id] = []
  set(chatMessages, newData)
})

export const cleanConversationMessages = atom(null, (get, set, id: string) => {
  const newData: Record<string, ThreadMessage[]> = {
    ...get(chatMessages),
  }
  newData[id] = newData[id].filter((e) => e.role === ChatCompletionRole.System)
  set(chatMessages, newData)
})

export const deleteMessage = atom(null, (get, set, id: string) => {
  const newData: Record<string, ThreadMessage[]> = {
    ...get(chatMessages),
  }
  const threadId = get(currentConversationAtom)?.id
  if (threadId) {
    newData[threadId] = newData[threadId].filter((e) => e.id !== id)
    set(chatMessages, newData)
  }
})

export const updateMessageAtom = atom(
  null,
  (
    get,
    set,
    id: string,
    conversationId: string,
    text: string,
    status: MessageStatus
  ) => {
    const messages = get(chatMessages)[conversationId] ?? []
    const message = messages.find((e) => e.id === id)
    if (message) {
      message.content = text
      message.status = status
      const updatedMessages = [...messages]

      const newData: Record<string, ThreadMessage[]> = {
        ...get(chatMessages),
      }
      newData[conversationId] = updatedMessages
      set(chatMessages, newData)
      // Update thread last message
      set(updateThreadStateLastMessageAtom, conversationId, text)
    }
  }
)

/**
 * For updating the status of the last AI message that is pending
 */
export const updateLastMessageAsReadyAtom = atom(
  null,
  (get, set, id, text: string) => {
    const currentConvoId = get(getActiveConvoIdAtom)
    if (!currentConvoId) return

    const currentMessages = get(chatMessages)[currentConvoId] ?? []
    const messageToUpdate = currentMessages.find((e) => e.id === id)

    // if message is not found, do nothing
    if (!messageToUpdate) return

    const index = currentMessages.indexOf(messageToUpdate)
    const updatedMsg: ThreadMessage = {
      ...messageToUpdate,
      status: MessageStatus.Ready,
      content: text,
    }

    currentMessages[index] = updatedMsg
    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[currentConvoId] = currentMessages
    set(chatMessages, newData)
  }
)
