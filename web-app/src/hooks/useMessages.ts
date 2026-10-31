import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { getServiceHub } from '@/hooks/useServiceHub'

type MessageState = {
  messages: Record<string, ThreadMessage[]>
  getMessages: (threadId: string) => ThreadMessage[]
  setMessages: (threadId: string, messages: ThreadMessage[]) => void
  addMessage: (message: ThreadMessage) => void
  updateMessage: (message: ThreadMessage) => void
  deleteMessage: (threadId: string, messageId: string) => void
  clearAllMessages: () => void
}

// A failed head stays queued. Later edits/deletes must never overtake it.
type WriteQueue = { jobs: Array<() => Promise<unknown>>; running?: Promise<void>; error?: unknown; reported?: boolean }
const writes = new Map<string, WriteQueue>()
function drain(queue: WriteQueue): Promise<void> {
  if (queue.running) return queue.running
  queue.running = (async () => {
    while (queue.jobs.length) {
      try { await queue.jobs[0](); queue.jobs.shift(); queue.error = undefined; queue.reported = false }
      catch (error) { queue.error = error; queue.reported = false; throw error }
    }
  })().finally(() => { queue.running = undefined })
  void queue.running.catch(() => {})
  return queue.running
}
function enqueue(threadId: string, job: () => Promise<unknown>) {
  const queue = writes.get(threadId) ?? { jobs: [] }
  writes.set(threadId, queue)
  queue.jobs.push(job)
  if (!queue.error) void drain(queue).catch((error) => console.error('Failed to persist message:', error))
}
/** Explicit close retry retries failed heads, preserving create/update/delete order. */
export async function flushMessageWrites(): Promise<void> {
  for (const queue of writes.values()) {
    if (queue.error && !queue.reported) { queue.reported = true; throw queue.error }
  }
  const results = await Promise.allSettled([...writes.values()].map(async (queue) => {
    try { await drain(queue) } catch (error) { queue.reported = true; throw error }
  }))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  if ([...writes.values()].some((queue) => queue.jobs.length || queue.running)) await flushMessageWrites()
}
export function __resetMessageWritesForTests() { writes.clear() }

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

    enqueue(message.thread_id, () => getServiceHub().messages().createMessage(newMessage))
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

    enqueue(message.thread_id, () => getServiceHub().messages().modifyMessage(updatedMessage))
  },
  deleteMessage: (threadId, messageId) => {
    enqueue(threadId, () => getServiceHub().messages().deleteMessage(threadId, messageId))
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
