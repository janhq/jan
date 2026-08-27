import { useState } from 'react'
import { Check, ChevronDown, Loader2, Minus } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import type { TodoList, TodoStatus } from '@/hooks/useCodeSessions'
import { CodeSidePanel } from '@/containers/CodeSidePanel'
import { cleanTaskLabel } from '@/lib/todoLabels'

/** Status dot: filled when resolved, hollow while still open. */
function StatusDot({ status }: { status: TodoStatus }) {
  const base = 'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full'
  if (status === 'completed') {
    return (
      <span className={cn(base, 'bg-primary text-primary-foreground')}>
        <Check size={11} strokeWidth={3} />
      </span>
    )
  }
  if (status === 'abandoned') {
    return (
      <span className={cn(base, 'bg-main-view-fg/20 text-main-view-fg/70')}>
        <Minus size={11} strokeWidth={3} />
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className={cn(base, 'text-primary')}>
        <Loader2 size={13} className="animate-spin" />
      </span>
    )
  }
  return <span className={cn(base, 'border-[1.5px] border-main-view-fg/25')} />
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const phases = todos?.phases ?? []
  const tasks = phases.flatMap((p) => p.tasks)
  const done = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'abandoned'
  ).length
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  const togglePhase = (name: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <CodeSidePanel
      title={t('common:todoPanelTitle')}
      summary={
        tasks.length > 0 ? (
          <span className="shrink-0 font-mono text-xs tabular-nums text-main-view-fg/60">
            {done}/{tasks.length}
          </span>
        ) : null
      }
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        {tasks.length > 0 && (
          // Thin progress bar under the header, so overall completion reads at
          // a glance without parsing the list.
          <div className="h-0.5 shrink-0 bg-main-view-fg/10">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {phases.length === 0 ? (
            <p className="text-sm text-main-view-fg/50">{t('common:todoPanelEmpty')}</p>
          ) : (
            phases.map((phase, phaseIdx) => {
              const isCollapsed = collapsed.has(phase.name)
              const phaseDone = phase.tasks.filter(
                (task) => task.status === 'completed' || task.status === 'abandoned'
              ).length
              return (
                <section key={phase.name} className={cn(phaseIdx > 0 && 'mt-3.5')}>
                  {/* A flat single-phase list has no meaningful phase name to
                      show, so the header is skipped entirely there. */}
                  {phase.name && (
                    <button
                      type="button"
                      onClick={() => togglePhase(phase.name)}
                      className="group mb-1 flex w-full items-center gap-1 text-left"
                    >
                      <ChevronDown
                        size={11}
                        className={cn(
                          'shrink-0 text-main-view-fg/40 transition-transform',
                          isCollapsed && '-rotate-90'
                        )}
                      />
                      <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-main-view-fg/50">
                        {phase.name}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-main-view-fg/35">
                        {phaseDone}/{phase.tasks.length}
                      </span>
                    </button>
                  )}
                  {!isCollapsed && (
                    <ul className="space-y-1">
                      {phase.tasks.map((task, i) => {
                        const resolved =
                          task.status === 'completed' || task.status === 'abandoned'
                        return (
                          <li
                            key={`${phase.name}-${i}`}
                            className="flex items-start gap-2 pl-0.5"
                          >
                            <StatusDot status={task.status} />
                            <span
                              className={cn(
                                'text-[13px] leading-5',
                                resolved && 'text-main-view-fg/40 line-through',
                                task.status === 'in_progress' && 'font-medium'
                              )}
                            >
                              {cleanTaskLabel(task.content)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>
    </CodeSidePanel>
  )
}
