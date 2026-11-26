import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { toast } from 'sonner'
import { i18n } from '@/i18n/react-i18next-compat'
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

/**
 * Per-thread write queue. A failed head stays queued: later edits/deletes must
 * never overtake it, or a stale write could land after a newer one.
 *
 * A failed head is retried on its own (bounded backoff, then it stops so a
 * dead disk does not spin forever), on every later enqueue, on the toast's
 * Retry action and on the window-close flush. While any queue is failing the
 * user sees a persistent toast, because the UI otherwise shows the message as
 * saved. Failure never drops a write: data loss is worse than a stalled queue.
 */
type WriteQueue = {
  jobs: Array<() => Promise<unknown>>
  running?: Promise<void>
  failing: boolean
  retries: number
  retryTimer?: ReturnType<typeof setTimeout>
  dropped: boolean
}

/** Delay before each automatic retry of a failed head; its length bounds them. */
const MESSAGE_WRITE_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000]
const WRITE_FAILED_TOAST_ID = 'message-writes-failed'
const writes = new Map<string, WriteQueue>()

const noop = () => {}

function retryNow(queue: WriteQueue) {
  queue.retries = 0
  void drain(queue).catch(noop)
}

function dismissToastIfHealthy() {
  if (![...writes.values()].some((queue) => queue.failing)) toast.dismiss(WRITE_FAILED_TOAST_ID)
}

function onWriteFailed(queue: WriteQueue, error: unknown) {
  console.error('Failed to persist message:', error)
  if (queue.dropped) return
  queue.failing = true
  toast.error(i18n.t('common:messageWrites.failedTitle'), {
    id: WRITE_FAILED_TOAST_ID,
    description: i18n.t('common:messageWrites.failedDescription'),
    duration: Infinity,
    action: {
      label: i18n.t('common:messageWrites.retry'),
      onClick: () => writes.forEach((q) => q.failing && retryNow(q)),
    },
  })
  const delay = MESSAGE_WRITE_RETRY_DELAYS_MS[queue.retries]
  if (delay === undefined) return
  queue.retries += 1
  queue.retryTimer = setTimeout(() => void drain(queue).catch(noop), delay)
}

function drain(queue: WriteQueue): Promise<void> {
  if (queue.running) return queue.running
  clearTimeout(queue.retryTimer)
  queue.retryTimer = undefined
  queue.running = (async () => {
    while (queue.jobs.length) {
      try {
        await queue.jobs[0]()
      } catch (error) {
        onWriteFailed(queue, error)
        throw error
      }
      queue.jobs.shift()
      if (queue.failing) {
        queue.failing = false
        dismissToastIfHealthy()
      }
    }
  })().finally(() => { queue.running = undefined })
  void queue.running.catch(noop)
  return queue.running
}
function enqueue(threadId: string, job: () => Promise<unknown>) {
  const queue = writes.get(threadId) ?? { jobs: [], failing: false, retries: 0, dropped: false }
  writes.set(threadId, queue)
  queue.jobs.push(job)
  retryNow(queue)
}

/**
 * Drop a deleted thread's queue: its pending writes target a thread that no
 * longer exists, and the map would otherwise keep an entry per thread forever.
 */
export function forgetMessageWrites(threadId: string): void {
  const queue = writes.get(threadId)
  if (!queue) return
  queue.dropped = true
  queue.jobs.length = 0
  clearTimeout(queue.retryTimer)
  writes.delete(threadId)
  if (queue.failing) dismissToastIfHealthy()
}
/**
 * Explicit close retry: drain FIRST, retrying failed heads in order, and throw
 * only what still fails now. A past background failure whose storage has since
 * recovered must not fail the close that would have drained it.
 */
export async function flushMessageWrites(): Promise<void> {
  const results = await Promise.allSettled([...writes.values()].map((queue) => drain(queue)))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  if ([...writes.values()].some((queue) => queue.jobs.length || queue.running)) await flushMessageWrites()
}
export function __resetMessageWritesForTests() {
  writes.forEach((queue) => clearTimeout(queue.retryTimer))
  writes.clear()
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
