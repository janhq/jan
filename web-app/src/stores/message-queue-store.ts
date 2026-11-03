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
  // Threads whose queue is held after an error. A held queue never drains on
  // its own and later submissions append behind it, until the user resumes or
  // clears it.
  paused: Record<string, boolean>

  pause: (threadId: string) => void
  resume: (threadId: string) => void
  isPaused: (threadId: string) => boolean
  enqueue: (threadId: string, message: QueuedMessage) => void
  dequeue: (threadId: string) => QueuedMessage | undefined
  removeMessage: (threadId: string, messageId: string) => void
  clearQueue: (threadId: string) => void
  getQueue: (threadId: string) => QueuedMessage[]
}

function withoutPause(
  state: { paused: Record<string, boolean> },
  threadId: string
): { paused: Record<string, boolean> } | undefined {
  if (!state.paused[threadId]) return undefined
  const paused = { ...state.paused }
  delete paused[threadId]
  return { paused }
}

export const useMessageQueue = create<MessageQueueState>((set, get) => ({
  queues: {},
  paused: {},

  // Only a non-empty queue can be held: there is nothing to protect otherwise.
  pause: (threadId) => {
    set((state) => {
      if (state.paused[threadId] || !state.queues[threadId]?.length) return state
      return { paused: { ...state.paused, [threadId]: true } }
    })
  },

  resume: (threadId) => {
    set((state) => withoutPause(state, threadId) ?? state)
  },

  isPaused: (threadId) => get().paused[threadId] === true,

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
      return {
        queues: { ...state.queues, [threadId]: filtered },
        ...(filtered.length === 0 ? withoutPause(state, threadId) : {}),
      }
    })
  },

  clearQueue: (threadId) => {
    set((state) => {
      const cleared = withoutPause(state, threadId)
      if (!state.queues[threadId]?.length) return cleared ?? state
      const updated = { ...state.queues }
      delete updated[threadId]
      return { queues: updated, ...cleared }
    })
  },

  getQueue: (threadId) => {
    return get().queues[threadId] ?? EMPTY_QUEUE
  },
}))
