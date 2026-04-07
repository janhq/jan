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

export function fitLevelTone(fitLevel?: string) {
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

export function fitLevelKey(fitLevel?: string) {
  switch (fitLevel) {
    case 'Perfect':
      return 'hub:scoreSummary.fitLevels.perfect'
    case 'Good':
      return 'hub:scoreSummary.fitLevels.good'
    case 'Marginal':
      return 'hub:scoreSummary.fitLevels.marginal'
    case 'Too Tight':
      return 'hub:scoreSummary.fitLevels.tooTight'
    default:
      return undefined
  }
}

export function runModeKey(runMode?: string) {
  switch (runMode) {
    case 'GPU':
      return 'hub:scoreSummary.runModes.gpu'
    case 'CPU Offload':
      return 'hub:scoreSummary.runModes.cpuOffload'
    case 'CPU Only':
      return 'hub:scoreSummary.runModes.cpuOnly'
    case 'MoE Offload':
      return 'hub:scoreSummary.runModes.moeOffload'
    case 'Tensor Parallel':
      return 'hub:scoreSummary.runModes.tensorParallel'
    default:
      return undefined
  }
}

export function renderLabel(
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
