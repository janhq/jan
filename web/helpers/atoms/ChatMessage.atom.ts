import { Message, MessageContent } from '@janhq/core'
import { atom } from 'jotai'

import { getActiveThreadIdAtom } from './Thread.atom'

const chatMessages = atom<Record<string, Message[]>>({})

export const disableStopInferenceAtom = atom(false)

export const chunkCountAtom = atom<Record<string, number>>({})

/**
 * Return the chat messages for the current active thread
 */
export const getCurrentChatMessagesAtom = atom<Message[]>((get) => {
  const activeThreadId = get(getActiveThreadIdAtom)
  if (!activeThreadId) return []
  const messages = get(chatMessages)[activeThreadId]
  return messages ?? []
})

// TODO: rename this function to add instead of set
export const setThreadMessagesAtom = atom(
  null,
  (get, set, threadId: string, messages: Message[]) => {
    const newData: Record<string, Message[]> = {
      ...get(chatMessages),
    }
    newData[threadId] = [...(newData.messages ?? []), ...messages.reverse()]
    set(chatMessages, newData)
  }
)

export const addNewMessageAtom = atom(null, (get, set, newMessage: Message) => {
  const currentMessages = get(chatMessages)[newMessage.thread_id] ?? []
  const updatedMessages = [...currentMessages, newMessage]

  const newData: Record<string, Message[]> = {
    ...get(chatMessages),
  }
  newData[newMessage.thread_id] = updatedMessages
  set(chatMessages, newData)
})

export const deleteChatMessageAtom = atom(
  null,
  (get, set, threadId: string) => {
    const newData: Record<string, Message[]> = {
      ...get(chatMessages),
    }
    newData[threadId] = []
    set(chatMessages, newData)
  }
)

export const cleanChatMessageAtom = atom(null, (get, set, id: string) => {
  const newData: Record<string, Message[]> = {
    ...get(chatMessages),
  }
  newData[id] = []
  set(chatMessages, newData)
})

export const deleteMessageAtom = atom(null, (get, set, id: string) => {
  const newData: Record<string, Message[]> = {
    ...get(chatMessages),
  }
  const threadId = get(getActiveThreadIdAtom)
  if (!threadId) return

  newData[threadId] = newData[threadId].filter((e) => e.id !== id)
  set(chatMessages, newData)
})

export const editMessageAtom = atom('')

export const updateMessageAtom = atom(
  null,
  (
    get,
    set,
    id: string,
    threadId: string,
    text: MessageContent[],
    status: 'in_progress' | 'completed' | 'incomplete'
  ) => {
    const messages = get(chatMessages)[threadId] ?? []
    const message = messages.find((e) => e.id === id)
    if (!message) return
    message.content = text
    message.status = status
    const updatedMessages = [...messages]
    const newData: Record<string, Message[]> = {
      ...get(chatMessages),
    }
    newData[threadId] = updatedMessages
    set(chatMessages, newData)
  }
)
