import { useState } from 'react'
import { CheckCircle2, Circle, ChevronDown, Loader2 } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import type { TodoList } from '@/hooks/useCodeSessions'
import { CodeSidePanel } from '@/containers/CodeSidePanel'

function TaskIcon({ status }: { status: string }): React.ReactElement {
  if (status === 'completed') {
    return <CheckCircle2 size={16} className="shrink-0 text-primary" />
  }
  if (status === 'in_progress') {
    return <Loader2 size={16} className="shrink-0 animate-spin text-primary" />
  }
  // 'abandoned' shares the muted/struck styling with 'completed' below, but
  // keeps an empty ring so it doesn't read as done.
  return <Circle size={16} className="shrink-0 text-main-view-fg/30" />
}

/**
 * Session todo list panel, mirroring the agent core's canonical todo tool
 * (see todo.rs) the TUI already renders as a HUD. Read-only: the model owns
 * mutations via the `todo` tool; this just projects the current snapshot.
 */
export function CodeTodoPanel({
  todos,
  onClose,
}: {
  todos: TodoList | undefined
  onClose: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(() => new Set())
  const phases = todos?.phases ?? []
  const allTasks = phases.flatMap((p) => p.tasks)
  const done = allTasks.filter(
    (t) => t.status === 'completed' || t.status === 'abandoned'
  ).length

  const togglePhase = (name: string) => {
    setCollapsedPhases((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <CodeSidePanel
      title={t('common:todoPanelTitle')}
      summary={
        allTasks.length > 0 ? (
          <span className="shrink-0 text-xs text-main-view-fg/60">
            {done}/{allTasks.length}
          </span>
        ) : null
      }
      onClose={onClose}
    >
      <div className="h-full overflow-y-auto p-3">
        {phases.length === 0 ? (
          <p className="text-sm text-main-view-fg/60">{t('common:todoPanelEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {phases.map((phase) => {
              const collapsed = collapsedPhases.has(phase.name)
              return (
                <div key={phase.name}>
                  <button
                    type="button"
                    onClick={() => togglePhase(phase.name)}
                    className="mb-1 flex w-full items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-main-view-fg/60"
                  >
                    <ChevronDown
                      size={12}
                      className={cn('shrink-0 transition-transform', collapsed && '-rotate-90')}
                    />
                    {phase.name}
                  </button>
                  {!collapsed && (
                    <ul className="flex flex-col gap-1.5 pl-1">
                      {phase.tasks.map((task, i) => (
                        <li
                          key={`${phase.name}-${i}`}
                          className="flex items-start gap-2 text-sm"
                        >
                          <TaskIcon status={task.status} />
                          <span
                            className={cn(
                              (task.status === 'completed' ||
                                task.status === 'abandoned') &&
                                'text-main-view-fg/50 line-through'
                            )}
                          >
                            {task.content}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CodeSidePanel>
  )
}
