import { CircleSlash, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

type Props =
  | { kind: 'stopped' }
  | { kind: 'error'; message?: string; onRetry: () => void }

/**
 * How a run ended when it ended without an answer.
 *
 * Split from the budget notice by weight, not by wording: a stop is something
 * the user just did and needs no colour, while a failure is the one state on
 * this surface that should look like one. Neither is a tool call, which is what
 * they used to be rendered as — a fake `error` tool whose card claimed the agent
 * had run something.
 */
export function CoworkRunNotice(props: Props) {
  const { t } = useTranslation()

  if (props.kind === 'stopped') {
    return (
      <div
        role="status"
        data-testid="cowork-run-notice"
        className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <CircleSlash size={14} aria-hidden className="shrink-0" />
        <span>{t('common:run.stopped')}</span>
      </div>
    )
  }

  return (
    <div
      role="alert"
      data-testid="cowork-run-notice"
      className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive"
    >
      <TriangleAlert size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 break-words">
        {props.message?.trim() || t('common:run.failed')}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={props.onRetry}
      >
        {t('common:run.tryAgain')}
      </Button>
    </div>
  )
}
