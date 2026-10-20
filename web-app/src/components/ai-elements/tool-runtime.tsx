import { memo, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatCompactDuration } from '@/lib/duration'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'

/**
 * Seconds since `startedAt`, ticking while the call is in flight and frozen at
 * `endedAt` once it settles.
 */
function useElapsedSeconds(
  startedAt?: number,
  endedAt?: number
): number | undefined {
  const isRunning = startedAt !== undefined && endedAt === undefined
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning, startedAt])

  if (startedAt === undefined) return undefined
  return Math.max(0, ((endedAt ?? now) - startedAt) / 1000)
}

export type ToolElapsedProps = {
  startedAt?: number
  endedAt?: number
  className?: string
}

export const ToolElapsed = memo(
  ({ startedAt, endedAt, className }: ToolElapsedProps) => {
    const { t } = useTranslation()
    const seconds = useElapsedSeconds(startedAt, endedAt)

    if (seconds === undefined) return null
    // A settled call under a second has no duration worth reporting; a running
    // one still shows 0s, so the timer is visibly live from the start.
    if (endedAt !== undefined && seconds < 1) return null

    return (
      <span className={cn('shrink-0 tabular-nums text-xs', className)}>
        {formatCompactDuration(seconds, t)}
      </span>
    )
  }
)

ToolElapsed.displayName = 'ToolElapsed'

export type ToolProgressRowProps = {
  toolCallId?: string
  className?: string
}

/**
 * Live progress from an MCP server. Most servers never send
 * `notifications/progress`, so this renders only once one does.
 */
export const ToolProgressRow = memo(
  ({ toolCallId, className }: ToolProgressRowProps) => {
    const { t } = useTranslation()
    const update = useToolCallRuntime((s) =>
      toolCallId ? s.progress[toolCallId] : undefined
    )

    if (!update) return null

    const label = update.message ?? t('tools:toolCall.working')

    return (
      <div className={cn('mt-2 flex flex-col gap-1', className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{label}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {update.percent === undefined
              ? // No total means no completion fraction to show, so report the
                // raw count the server is counting up.
                Math.round(update.progress)
              : `${Math.round(update.percent)}%`}
          </span>
        </div>
        {update.percent !== undefined && (
          <div
            role="progressbar"
            aria-valuenow={Math.round(update.percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 w-full overflow-hidden rounded-full bg-main-view-fg/10"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${update.percent}%` }}
            />
          </div>
        )}
      </div>
    )
  }
)

ToolProgressRow.displayName = 'ToolProgressRow'
