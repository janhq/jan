import {
  ChatCompletionRole,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'
import { atom } from 'jotai'

import { atomWithStorage } from 'jotai/utils'

import {
  getActiveThreadIdAtom,
  updateThreadStateLastMessageAtom,
} from './Thread.atom'

import { TokenSpeed } from '@/types/token'

const CHAT_MESSAGE_NAME = 'chatMessages'
/**
 * Stores all chat messages for all threads
 */
export const chatMessagesStorage = atomWithStorage<
  Record<string, ThreadMessage[]>
>(CHAT_MESSAGE_NAME, {}, undefined, { getOnInit: true })

export const cachedMessages = atom<Record<string, ThreadMessage[]>>()
/**
 * Retrieve chat messages for all threads
 */
export const chatMessages = atom(
  (get) => get(cachedMessages) ?? get(chatMessagesStorage),
  (_get, set, newValue: Record<string, ThreadMessage[]>) => {
    set(cachedMessages, newValue)
    ;(() => set(chatMessagesStorage, newValue))()
  }
)

/**
 * Store subscribed generating message thread
 */
export const subscribedGeneratingMessageAtom = atom<{
  thread_id?: string
}>({})

/**
 * Stores the status of the messages load for each thread
 */
export const readyThreadsMessagesAtom = atomWithStorage<
  Record<string, boolean>
>('currentThreadMessages', {}, undefined, { getOnInit: true })

/**
 * Store the token speed for current message
 */
export const tokenSpeedAtom = atom<TokenSpeed | undefined>(undefined)
/**
 * Return the chat messages for the current active conversation
 */
export const getCurrentChatMessagesAtom = atom<ThreadMessage[]>((get) => {
  const activeThreadId = get(getActiveThreadIdAtom)
  if (!activeThreadId) return []
  const messages = get(chatMessages)[activeThreadId]
  if (!Array.isArray(messages)) return []
  return messages ?? []
})

export const setConvoMessagesAtom = atom(
  null,
  (get, set, threadId: string, messages: ThreadMessage[]) => {
    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[threadId] = messages
    set(chatMessages, newData)
    set(readyThreadsMessagesAtom, {
      ...get(readyThreadsMessagesAtom),
      [threadId]: true,
    })
  }
)

/**
 * Used for pagination. Add old messages to the current conversation
 */
export const addOldMessagesAtom = atom(
  null,
  (get, set, newMessages: ThreadMessage[]) => {
    const currentConvoId = get(getActiveThreadIdAtom)
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
    const currentMessages = get(chatMessages)[newMessage.thread_id] ?? []
    const updatedMessages = [...currentMessages, newMessage]

    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[newMessage.thread_id] = updatedMessages
    set(chatMessages, newData)

    // Update thread last message
    if (newMessage.content.length)
      set(
        updateThreadStateLastMessageAtom,
        newMessage.thread_id,
        newMessage.content
      )
  }
)

export const deleteChatMessageAtom = atom(
  null,
  (get, set, threadId: string) => {
    const newData: Record<string, ThreadMessage[]> = {
      ...get(chatMessages),
    }
    newData[threadId] = []
    set(chatMessages, newData)
  }
)

export const cleanChatMessageAtom = atom(null, (get, set, id: string) => {
  const newData: Record<string, ThreadMessage[]> = {
    ...get(chatMessages),
  }
  newData[id] = newData[id]?.filter((e) => e.role === ChatCompletionRole.System)
  set(chatMessages, newData)
})

export const deleteMessageAtom = atom(null, (get, set, id: string) => {
  const newData: Record<string, ThreadMessage[]> = {
    ...get(chatMessages),
  }
  const threadId = get(getActiveThreadIdAtom)
  if (threadId) {
    // Should also delete error messages to clear out the error state
    newData[threadId] = newData[threadId].filter(
      (e) => e.id !== id && !e.metadata?.error
    )

    set(chatMessages, newData)
  }
})

export const editMessageAtom = atom('')

export const updateMessageAtom = atom(
  null,
  (
    get,
    set,
    id: string,
    conversationId: string,
    text: ThreadContent[],
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
      if (text.length)
        set(updateThreadStateLastMessageAtom, conversationId, text)
    } else {
      set(addNewMessageAtom, {
        id,
        thread_id: conversationId,
        content: text,
        status,
        role: ChatCompletionRole.Assistant,
        created_at: Date.now() / 1000,
        completed_at: Date.now() / 1000,
        object: 'thread.message',
      })
    }
  }
)
