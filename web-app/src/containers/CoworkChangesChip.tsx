import { FileDiff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { CoworkFileDiff } from '@/lib/coworkDiffs'

/**
 * Opens the diff rail, and stays out of the way until the agent has written
 * something — the same rule the plan, folder and skills controls follow.
 */
export function CoworkChangesChip({
  files,
  open,
  onToggle,
}: {
  files: CoworkFileDiff[]
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  if (files.length === 0) return null

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={open}
          aria-label={t('common:changes.a11y', {
            files: files.length,
            additions,
            deletions,
          })}
          onClick={onToggle}
          className={cn('shrink-0', open && 'text-primary')}
        >
          <FileDiff className="size-3.5 shrink-0" />
          <span className="font-mono tabular-nums text-muted-foreground">
            +{additions}
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            -{deletions}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('common:changes.title')}</TooltipContent>
    </Tooltip>
  )
}
