import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { coworkModelContext, formatContextSize } from '@/lib/coworkModelControls'

/**
 * Opens the model rail, and only when there is something to configure -- a
 * local llamacpp/mlx model with settings. Remote providers have no local knobs,
 * so the chip stays hidden there like the diff/tasks chips do when empty.
 */
export function CoworkModelChip({
  model,
  provider,
  open,
  onToggle,
}: {
  model: Model | undefined
  provider: ProviderObject | undefined
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  if (!model || !provider || !model.settings) return null

  const context = coworkModelContext(provider, model.id)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={open}
          aria-label={t('common:modelPanel.a11y')}
          onClick={onToggle}
          className={cn('shrink-0', open && 'text-primary')}
        >
          <SlidersHorizontal className="size-3.5 shrink-0" />
          {context && (
            <span className="font-mono tabular-nums text-main-view-fg/60">
              {formatContextSize(context.value)}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('common:modelPanel.title')}</TooltipContent>
    </Tooltip>
  )
}
