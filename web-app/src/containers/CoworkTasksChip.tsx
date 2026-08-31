import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { SubagentRun } from '@/types/coworkSession'

/**
 * Opens the background-tasks rail, and stays out of the way until the agent
 * has dispatched a subagent — the same rule the changes chip follows.
 */
export function CoworkTasksChip({
  subagents,
  open,
  onToggle,
}: {
  subagents: SubagentRun[]
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  if (subagents.length === 0) return null

  const active = subagents.filter((s) => s.status !== 'done').length

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={open}
          aria-label={t('common:backgroundTasks')}
          onClick={onToggle}
          className={cn('shrink-0', open && 'text-primary')}
        >
          {active > 0 ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="size-3.5 shrink-0" />
          )}
          <span className="font-mono tabular-nums text-muted-foreground">
            {active > 0 ? `${active}/${subagents.length}` : subagents.length}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('common:backgroundTasks')}</TooltipContent>
    </Tooltip>
  )
}
