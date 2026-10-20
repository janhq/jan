import { ListTodo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { TodoList } from '@/types/coworkSession'

/**
 * Opens the progress rail, and stays out of the way until the agent has
 * written a todo list — the same rule the changes chip follows.
 */
export function CoworkTodoChip({
  todos,
  open,
  onToggle,
}: {
  todos: TodoList | undefined
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const tasks = (todos?.phases ?? []).flatMap((p) => p.tasks)
  if (tasks.length === 0) return null

  const done = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'abandoned'
  ).length

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={open}
          aria-label={t('common:todoPanelTitle')}
          onClick={onToggle}
          className={cn('shrink-0', open && 'text-primary')}
        >
          <ListTodo className="size-3.5 shrink-0" />
          <span className="font-mono tabular-nums text-muted-foreground">
            {done}/{tasks.length}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('common:todoPanelTitle')}</TooltipContent>
    </Tooltip>
  )
}
