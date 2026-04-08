import type { ModelScore } from '@/services/models/types'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Loader } from 'lucide-react'
import { IconRocket } from '@tabler/icons-react'

const FIT_LEVEL_TONE: Record<string, string> = {
  'Perfect': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Good': 'border-sky-200 bg-sky-50 text-sky-700',
  'Marginal': 'border-amber-200 bg-amber-50 text-amber-700',
  'Too Tight': 'border-rose-200 bg-rose-50 text-rose-700',
}

const FIT_LEVEL_TRANSLATION_KEYS: Record<string, string> = {
  'Perfect': 'hub:scoreSummary.fitLevels.perfect',
  'Good': 'hub:scoreSummary.fitLevels.good',
  'Marginal': 'hub:scoreSummary.fitLevels.marginal',
  'Too Tight': 'hub:scoreSummary.fitLevels.tooTight',
}

interface ModelScoreSummaryProps {
  score?: ModelScore
  compact?: boolean
  disabled?: boolean
  className?: string
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
  const translatedFitLevelKey = fitLevel
    ? FIT_LEVEL_TRANSLATION_KEYS[fitLevel]
    : undefined
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
            fitLevel ? FIT_LEVEL_TONE[fitLevel] : undefined,
            !fitLevel && 'border-border bg-secondary/60 text-muted-foreground'
          )}
        >
          {translatedFitLevel}
        </span>
      )}
    </div>
  )
}
