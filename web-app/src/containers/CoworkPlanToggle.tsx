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
 * A pressed-state button, not a Switch: a Switch reads as a settings control
 * and is too tall for the 28px dock row, and this is a mode flipped mid-
 * conversation.
 *
 * The visual cues are deliberately quiet — a filled glyph here, a placeholder
 * swap and one hairline on the composer. Tinting the composer made every
 * plan-mode session look like an error state.
 */
export function CoworkPlanToggle({ planMode, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={planMode ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={planMode}
            onClick={() => onChange(!planMode)}
            className={cn(
              'h-7 gap-1.5 rounded-full shrink-0',
              planMode && 'border-primary/40'
            )}
          >
            <Diamond
              size={13}
              aria-hidden
              className={cn(
                'shrink-0',
                planMode
                  ? 'fill-current text-primary'
                  : 'text-muted-foreground'
              )}
            />
            <span className={planMode ? undefined : 'text-muted-foreground'}>
              {t('common:planMode.label')}
            </span>
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
