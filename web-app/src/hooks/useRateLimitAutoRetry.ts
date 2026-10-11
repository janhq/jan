import { useEffect, useRef } from 'react'
import { useRateLimitRetry } from '@/stores/rate-limit-retry-store'

/**
 * Runs the thread's scheduled rate-limit retry (see rate-limit-retry-store)
 * when its wait is over, by regenerating the failed message, and starts the
 * retry count again once a reply finishes without error.
 */
export function useRateLimitAutoRetry(
  threadId: string,
  retry: (messageId: string) => void,
  { status }: { status: string }
): void {
  const pending = useRateLimitRetry((s) => s.pending[threadId])
  const retryRef = useRef(retry)
  retryRef.current = retry

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(
      () => {
        const due = useRateLimitRetry.getState().take(threadId)
        if (due) retryRef.current(due.messageId)
      },
      Math.max(0, pending.retryAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [pending, threadId])

  useEffect(() => {
    if (status === 'ready') useRateLimitRetry.getState().reset(threadId)
  }, [status, threadId])
}
