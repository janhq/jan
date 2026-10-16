import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  MAX_RATE_LIMIT_RETRIES,
  useRateLimitRetry,
} from '@/stores/rate-limit-retry-store'

const ONE_SECOND = 1_000

/**
 * Under a reply that hit the provider's rate limit: when Jan will retry on
 * its own, and a way to call that off.
 */
export function RateLimitRetryNotice({ messageId }: { messageId: string }) {
  const { t } = useTranslation()
  const threadId = useRateLimitRetry(
    (s) =>
      Object.keys(s.pending).find((id) => s.pending[id].messageId === messageId)
  )
  const pending = useRateLimitRetry((s) =>
    threadId ? s.pending[threadId] : undefined
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!pending) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ONE_SECOND)
    return () => clearInterval(timer)
  }, [pending])

  if (!threadId || !pending) return null

  const seconds = Math.max(0, Math.ceil((pending.retryAt - now) / ONE_SECOND))
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span role="status">
        {t('model-errors:rateLimitRetrying', {
          seconds,
          attempt: pending.attempt,
          max: MAX_RATE_LIMIT_RETRIES,
        })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => useRateLimitRetry.getState().cancel(threadId)}
      >
        {t('model-errors:rateLimitCancelRetry')}
      </Button>
    </div>
  )
}
