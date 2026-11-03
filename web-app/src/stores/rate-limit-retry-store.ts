import { create } from 'zustand'

/** Automatic retries in a row before Jan stops and asks the user. */
export const MAX_RATE_LIMIT_RETRIES = 2

export type PendingRateLimitRetry = {
  /** The message the failure is attached to, and the one to regenerate. */
  messageId: string
  /** When to retry, in ms since the epoch. */
  retryAt: number
  /** Which automatic retry this is, from 1. */
  attempt: number
}

type RateLimitRetryState = {
  /** The wait a rate-limited request asked for, per thread, until scheduled. */
  reported: Record<string, number>
  /** Automatic retries made for the thread's current reply. */
  attempts: Record<string, number>
  /** The retry each thread is waiting for. */
  pending: Record<string, PendingRateLimitRetry>
  /** The message whose retries ran out, per thread, until a reply succeeds. */
  gaveUp: Record<string, string>
  /** The request for `threadId` hit the provider's rate limit. */
  report: (threadId: string, delayMs: number) => void
  /**
   * After a failure on `messageId`: schedule a retry if the failure was a
   * rate limit and retries are left.
   */
  schedule: (
    threadId: string,
    messageId: string,
    now: number
  ) => 'scheduled' | 'exhausted' | 'none'
  /** Remove and return the thread's scheduled retry, to run it. */
  take: (threadId: string) => PendingRateLimitRetry | undefined
  /** The user called the scheduled retry off. */
  cancel: (threadId: string) => void
  /** A reply succeeded: the next rate limit starts the count again. */
  reset: (threadId: string) => void
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record
  const rest = { ...record }
  delete rest[key]
  return rest
}

export const useRateLimitRetry = create<RateLimitRetryState>()((set, get) => ({
  reported: {},
  attempts: {},
  pending: {},
  gaveUp: {},
  report: (threadId, delayMs) =>
    set((state) => ({ reported: { ...state.reported, [threadId]: delayMs } })),
  schedule: (threadId, messageId, now) => {
    const delayMs = get().reported[threadId]
    if (delayMs === undefined) return 'none'
    const attempt = (get().attempts[threadId] ?? 0) + 1
    if (attempt > MAX_RATE_LIMIT_RETRIES) {
      set((state) => ({
        reported: without(state.reported, threadId),
        gaveUp: { ...state.gaveUp, [threadId]: messageId },
      }))
      return 'exhausted'
    }
    set((state) => ({
      reported: without(state.reported, threadId),
      attempts: { ...state.attempts, [threadId]: attempt },
      pending: {
        ...state.pending,
        [threadId]: { messageId, retryAt: now + delayMs, attempt },
      },
    }))
    return 'scheduled'
  },
  take: (threadId) => {
    const pending = get().pending[threadId]
    if (pending) set((state) => ({ pending: without(state.pending, threadId) }))
    return pending
  },
  cancel: (threadId) =>
    set((state) => ({ pending: without(state.pending, threadId) })),
  reset: (threadId) =>
    set((state) => ({
      reported: without(state.reported, threadId),
      attempts: without(state.attempts, threadId),
      pending: without(state.pending, threadId),
      gaveUp: without(state.gaveUp, threadId),
    })),
}))
