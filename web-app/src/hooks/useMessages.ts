import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import {
  createMessage,
  deleteMessage as deleteMessageExt,
} from '@/services/messages'

type MessageState = {
  messages: Record<string, ThreadMessage[]>
  setMessages: (threadId: string, messages: ThreadMessage[]) => void
  addMessage: (message: ThreadMessage) => void
  deleteMessage: (threadId: string, messageId: string) => void
}

export const useMessages = create<MessageState>()(
  persist(
    (set) => ({
      messages: {},
      setMessages: (threadId, messages) => {
        set((state) => ({
          messages: {
            ...state.messages,
            [threadId]: messages,
          },
        }))
      },
      addMessage: (message) => {
        createMessage(message).then((createdMessage) => {
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
    }),
    {
      name: localStoregeKey.messages,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
