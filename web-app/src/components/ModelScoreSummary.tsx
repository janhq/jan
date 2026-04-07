import type { ModelScore } from '@/services/models/types'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Loader } from 'lucide-react'
import { IconRocket } from '@tabler/icons-react'

interface ModelScoreSummaryProps {
  score?: ModelScore
  compact?: boolean
  disabled?: boolean
  className?: string
}

function fitLevelTone(fitLevel?: string) {
  switch (fitLevel) {
    case 'Perfect':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'Good':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    case 'Marginal':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'Too Tight':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    default:
      return 'border-border bg-secondary/60 text-muted-foreground'
  }
}

function fitLevelKey(fitLevel?: string) {
  switch (fitLevel) {
    case 'Perfect':
      return 'scoreSummary.fitLevels.perfect'
    case 'Good':
      return 'scoreSummary.fitLevels.good'
    case 'Marginal':
      return 'scoreSummary.fitLevels.marginal'
    case 'Too Tight':
      return 'scoreSummary.fitLevels.tooTight'
    default:
      return undefined
  }
}

function runModeKey(runMode?: string) {
  switch (runMode) {
    case 'GPU':
      return 'scoreSummary.runModes.gpu'
    case 'CPU Offload':
      return 'scoreSummary.runModes.cpuOffload'
    case 'CPU Only':
      return 'scoreSummary.runModes.cpuOnly'
    case 'MoE Offload':
      return 'scoreSummary.runModes.moeOffload'
    case 'Tensor Parallel':
      return 'scoreSummary.runModes.tensorParallel'
    default:
      return undefined
  }
}

function renderLabel(
  t: (key: string) => string,
  score?: ModelScore,
  disabled?: boolean
) {
  if (disabled) return t('scoreSummary.notAvailable')
  if (!score || score.status === 'loading') return t('scoreSummary.scoring')
  if (score.status === 'ready') return t('scoreSummary.personalizedScore')
  return t('scoreSummary.notAvailable')
}

export function ModelScoreBadge({
  score,
  compact = false,
  disabled = false,
  className,
}: ModelScoreSummaryProps) {
  const { t } = useTranslation('hub')
  const fitLevel =
    score?.status === 'ready' ? score.breakdown?.fit_level : undefined
  const translatedFitLevelKey = fitLevelKey(fitLevel)
  const translatedFitLevel = translatedFitLevelKey
    ? t(translatedFitLevelKey)
    : fitLevel

  return (
    <div className="gap-2 inline-flex items-center">
      <div
        className={cn(
          'px-2.5 py-1 flex items-center gap-1',
          compact && 'px-2 py-0.5',
          className
        )}
      >
        <IconRocket
          size={20}
          className="text-muted-foreground"
          title={t('hub:token-sec')}
        />
        <span className={cn('text-xs text-muted-foreground font-medium')}>
          {score?.status === 'ready' && typeof score.overall === 'number' ? (
            score.overall.toFixed(1)
          ) : (!score || score.status === 'loading') && !disabled ? (
            <Loader className="size-3 animate-spin text-muted-foreground" />
          ) : (
            t('scoreSummary.na')
          )}
        </span>
      </div>
      {compact && translatedFitLevel && (
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            fitLevelTone(fitLevel)
          )}
        >
          {translatedFitLevel}
        </span>
      )}
    </div>
  )
}

export function ModelScorePanel({
  score,
  disabled = false,
  className,
}: ModelScoreSummaryProps) {
  const { t } = useTranslation('hub')
  const breakdown = score?.breakdown
  const translatedFitLevelKey = fitLevelKey(breakdown?.fit_level)
  const translatedRunModeKey = runModeKey(breakdown?.run_mode)
  const translatedBreakdown = breakdown
    ? {
        ...breakdown,
        fit_level: translatedFitLevelKey
          ? t(translatedFitLevelKey)
          : breakdown.fit_level,
        run_mode: translatedRunModeKey
          ? t(translatedRunModeKey)
          : breakdown.run_mode,
      }
    : undefined

  return (
    <div
      className={cn('rounded-xl border border-border bg-card p-4', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('scoreSummary.hubScore')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {renderLabel(t, score, disabled)}
          </p>
        </div>
        <div className="text-right">
          <div className={cn('text-2xl font-semibold')}>
            {score?.status === 'ready' && typeof score.overall === 'number'
              ? score.overall.toFixed(1)
              : t('scoreSummary.na')}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('scoreSummary.outOf100')}
          </div>
        </div>
      </div>

      {score?.status === 'ready' && translatedBreakdown ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t('scoreSummary.quality'), translatedBreakdown.quality],
            [t('scoreSummary.speed'), translatedBreakdown.speed],
            [t('scoreSummary.fit'), translatedBreakdown.fit],
            [t('scoreSummary.context'), translatedBreakdown.context],
            [t('scoreSummary.tps'), score.estimated_tps],
            [t('scoreSummary.bestQuant'), translatedBreakdown.best_quant],
            [t('scoreSummary.fitLevel'), translatedBreakdown.fit_level],
            [t('scoreSummary.runMode'), translatedBreakdown.run_mode],
            [
              t('scoreSummary.memRequiredGb'),
              translatedBreakdown.memory_required_gb,
            ],
            [
              t('scoreSummary.utilizationPct'),
              translatedBreakdown.utilization_pct,
            ],
            [t('scoreSummary.useCase'), translatedBreakdown.use_case],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-secondary/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-lg font-medium text-foreground">
                {typeof value === 'number' ? value.toFixed(1) : value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-muted-foreground">
          {disabled
            ? t('scoreSummary.disabledDescription')
            : score?.reason || t('scoreSummary.pendingDescription')}
        </div>
      )}
    </div>
  )
}
