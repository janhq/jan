import { Diamond } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

type Props = {
  planMode: boolean
  onChange: (planMode: boolean) => void
}

/**
 * A pressed-state button, not a Switch: a Switch reads as a settings control,
 * and this is a mode flipped mid-conversation.
 *
 * Icon-only until it is on, then it grows a label. The composer's control row
 * is a row of quiet ghost icons; an outlined pill sitting among them read as
 * bolted on, and a mode that is off has nothing to say. `text-primary` for the
 * on state is the row's own convention, borrowed from the web-search toggle.
 */
export function CoworkPlanToggle({ planMode, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={planMode ? 'xs' : 'icon-xs'}
            aria-pressed={planMode}
            aria-label={t('common:planMode.label')}
            onClick={() => onChange(!planMode)}
            className={cn(
              'shrink-0',
              planMode ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Diamond
              aria-hidden
              className={cn(
                'shrink-0',
                planMode ? 'size-3.5 fill-current' : 'size-[18px]'
              )}
            />
            {planMode && <span>{t('common:planMode.label')}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {planMode
            ? t('common:planMode.tooltipOn')
            : t('common:planMode.tooltipOff')}
        </TooltipContent>
      </Tooltip>
      {/* The cues are subtle by design, so the change itself is announced. */}
      <span aria-live="polite" className="sr-only">
        {planMode ? t('common:planMode.onAnnounce') : ''}
      </span>
    </>
  )
}
