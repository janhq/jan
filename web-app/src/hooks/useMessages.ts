import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { getServiceHub } from '@/hooks/useServiceHub'

// IPC requests can complete out of order. Keep each thread's writes ordered so
// a late create/update cannot undo a branch change or recreate a deleted row.
// Different threads retain independent queues, and a failed write releases the
// next operation rather than poisoning the queue.
const pendingWrites = new Map<string, Promise<void>>()

function persistMessage(
  threadId: string,
  errorMessage: string,
  operation: () => Promise<unknown>
) {
  const run = async () => {
    try {
      await operation()
    } catch (error) {
      console.error(errorMessage, error)
    }
  }
  const previous = pendingWrites.get(threadId)
  const pending = previous ? previous.then(run) : run()
  pendingWrites.set(threadId, pending)
  void pending.then(() => {
    if (pendingWrites.get(threadId) === pending) pendingWrites.delete(threadId)
  })
}

type MessageState = {
  messages: Record<string, ThreadMessage[]>
  getMessages: (threadId: string) => ThreadMessage[]
  setMessages: (threadId: string, messages: ThreadMessage[]) => void
  addMessage: (message: ThreadMessage) => void
  updateMessage: (message: ThreadMessage) => void
  deleteMessage: (threadId: string, messageId: string) => void
  clearAllMessages: () => void
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
    const newMessage = {
      ...message,
      created_at: message.created_at || Date.now(),
    }

    // Optimistically update state immediately for instant UI feedback
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: [
          ...(state.messages[message.thread_id] || []),
          newMessage,
        ],
      },
    }))

    // Persist to storage asynchronously
    persistMessage(message.thread_id, 'Failed to persist message:', async () => {
      const createdMessage = await getServiceHub().messages().createMessage(newMessage)
      set((state) => {
        const messages = state.messages[message.thread_id]
        // A newer edit/branch update owns its own snapshot. A cleared store or
        // deleted row must not be repopulated by this acknowledgement either.
        if (!messages?.includes(newMessage)) return state
        return {
          messages: {
            ...state.messages,
            [message.thread_id]: messages.map((existing) =>
              existing === newMessage ? createdMessage : existing
            ),
          },
        }
      })
    })
  },
  updateMessage: (message) => {
    const updatedMessage = {
      ...message,
    }

    // Optimistically update state immediately for instant UI feedback
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: (state.messages[message.thread_id] || []).map((m) =>
          m.id === message.id ? updatedMessage : m
        ),
      },
    }))

    // Persist to storage asynchronously using modifyMessage instead of createMessage
    // to prevent duplicates when updating existing messages
    persistMessage(message.thread_id, 'Failed to persist message update:', () =>
      getServiceHub().messages().modifyMessage(updatedMessage)
    )
  },
  deleteMessage: (threadId, messageId) => {
    persistMessage(threadId, 'Failed to delete message:', () =>
      getServiceHub().messages().deleteMessage(threadId, messageId)
    )
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
  clearAllMessages: () => {
    set({ messages: {} })
  },
}))
