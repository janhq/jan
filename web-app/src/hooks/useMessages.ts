import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import {
  createMessage,
  deleteMessage as deleteMessageExt,
} from '@/services/messages'
import { useAssistant } from './useAssistant'

type MessageState = {
  messages: Record<string, ThreadMessage[]>
  getMessages: (threadId: string) => ThreadMessage[]
  setMessages: (threadId: string, messages: ThreadMessage[]) => void
  addMessage: (message: ThreadMessage) => void
  deleteMessage: (threadId: string, messageId: string) => void
}

export const useMessages = create<MessageState>()((set, get) => ({
  messages: {},
  getMessages: (threadId) => {
    return get().messages[threadId] || []
  },
  setMessages: (threadId, messages) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [threadId]: messages,
      },
    }))
  },
  addMessage: (message) => {
    const currentAssistant = useAssistant.getState().currentAssistant
    const newMessage = {
      ...message,
      created_at: message.created_at || Date.now(),
      metadata: {
        ...message.metadata,
        assistant: currentAssistant,
      },
    }
    createMessage(newMessage).then((createdMessage) => {
      set((state) => ({
        messages: {
          ...state.messages,
          [message.thread_id]: [
            ...(state.messages[message.thread_id] || []),
            createdMessage,
          ],
        },
      }))
    })
  },
  deleteMessage: (threadId, messageId) => {
    deleteMessageExt(threadId, messageId)
    set((state) => ({
      messages: {
        ...state.messages,
        [threadId]:
          state.messages[threadId]?.filter(
            (message) => message.id !== messageId
          ) || [],
      },
    }))
  },
}))
