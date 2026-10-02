import { Eye, Hourglass } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

/**
 * Stands in for the "Working…" indicator while the run is parked: the model has
 * answered and the loop is waiting on background work it started. Nothing is
 * generating, so a spinner that says "working" would misreport an idle model.
 * Names the monitors when any are up, since a watcher is otherwise invisible.
 */
export function CoworkParkedNotice({ watching }: { watching: number }) {
  const { t } = useTranslation()
  const Icon = watching > 0 ? Eye : Hourglass
  return (
    <div
      role="status"
      data-testid="cowork-parked-notice"
      className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-sm"
    >
      <Icon size={14} aria-hidden className="shrink-0 text-primary" />
      <span className="font-medium text-foreground">
        {watching > 0
          ? t('common:coworkWatching', { count: watching })
          : t('common:coworkWaitingBackground')}
      </span>
    </div>
  )
}
