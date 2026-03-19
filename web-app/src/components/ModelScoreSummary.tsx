import type { ModelScore } from '@/services/models/types'
import { cn } from '@/lib/utils'
import { Loader } from 'lucide-react'

interface ModelScoreSummaryProps {
  score?: ModelScore
  compact?: boolean
  disabled?: boolean
  className?: string
}

function scoreTone(score?: ModelScore) {
  if (!score?.overall) return 'text-muted-foreground'
  if (score.overall >= 80) return 'text-emerald-600'
  if (score.overall >= 60) return 'text-amber-600'
  return 'text-orange-600'
}

function renderLabel(score?: ModelScore, disabled?: boolean) {
  if (disabled) return 'Not available'
  if (!score || score.status === 'loading') return 'Scoring...'
  if (score.status === 'ready') return 'Personalized score'
  return 'Not available'
}

export function ModelScoreBadge({
  score,
  compact = false,
  disabled = false,
  className,
}: ModelScoreSummaryProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1',
        compact && 'px-2 py-0.5',
        className
      )}
    >
      {(!score || score.status === 'loading') && !disabled ? (
        <Loader className="size-3 animate-spin text-muted-foreground" />
      ) : null}
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Score
      </span>
      <span className={cn('text-sm font-semibold', scoreTone(score))}>
        {score?.status === 'ready' && typeof score.overall === 'number'
          ? score.overall.toFixed(1)
          : 'N/A'}
      </span>
    </div>
  )
}

export function ModelScorePanel({
  score,
  disabled = false,
  className,
}: ModelScoreSummaryProps) {
  const breakdown = score?.breakdown

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Hub Score
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {renderLabel(score, disabled)}
          </p>
        </div>
        <div className="text-right">
          <div className={cn('text-2xl font-semibold', scoreTone(score))}>
            {score?.status === 'ready' && typeof score.overall === 'number'
              ? score.overall.toFixed(1)
              : 'N/A'}
          </div>
          <div className="text-xs text-muted-foreground">out of 100</div>
        </div>
      </div>

      {score?.status === 'ready' && breakdown ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Quality', breakdown.quality],
            ['Speed', breakdown.speed],
            ['Fit', breakdown.fit],
            ['Context', breakdown.context],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-secondary/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-lg font-medium text-foreground">
                {(value as number).toFixed(1)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-muted-foreground">
          {disabled
            ? 'This model type does not support local llmfit scoring yet.'
            : score?.reason || 'A score will appear after local analysis completes.'}
        </div>
      )}
    </div>
  )
}
