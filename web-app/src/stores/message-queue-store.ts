import { create } from 'zustand'

export type QueuedMessage = {
  id: string
  text: string
  createdAt: number
}

// Stable reference for empty queues so selectors don't trigger unnecessary re-renders
const EMPTY_QUEUE: QueuedMessage[] = []

interface MessageQueueState {
  // Per-thread message queues
  queues: Record<string, QueuedMessage[]>

  enqueue: (threadId: string, message: QueuedMessage) => void
  dequeue: (threadId: string) => QueuedMessage | undefined
  removeMessage: (threadId: string, messageId: string) => void
  clearQueue: (threadId: string) => void
  getQueue: (threadId: string) => QueuedMessage[]
}

export const useMessageQueue = create<MessageQueueState>((set, get) => ({
  queues: {},

  enqueue: (threadId, message) => {
    set((state) => ({
      queues: {
        ...state.queues,
        [threadId]: [...(state.queues[threadId] ?? []), message],
      },
    }))
  },

  // Atomically removes and returns the first message from the queue.
  // The entire read-and-mutate happens inside set() to avoid stale-closure races.
  dequeue: (threadId) => {
    let first: QueuedMessage | undefined
    set((state) => {
      const queue = state.queues[threadId]
      if (!queue || queue.length === 0) return state
      const [head, ...rest] = queue
      first = head
      return { queues: { ...state.queues, [threadId]: rest } }
    })
    return first
  },

  removeMessage: (threadId, messageId) => {
    set((state) => {
      const queue = state.queues[threadId]
      if (!queue) return state
      const filtered = queue.filter((m) => m.id !== messageId)
      if (filtered.length === queue.length) return state
      return { queues: { ...state.queues, [threadId]: filtered } }
    })
  },

  clearQueue: (threadId) => {
    set((state) => {
      if (!state.queues[threadId]?.length) return state
      const updated = { ...state.queues }
      delete updated[threadId]
      return { queues: updated }
    })
  },

  getQueue: (threadId) => {
    return get().queues[threadId] ?? EMPTY_QUEUE
  },
}))
