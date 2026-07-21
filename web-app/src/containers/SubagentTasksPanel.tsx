/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, X, Loader2, Sparkles, AlertCircle } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, formatDuration, formatTokenCount } from '@/lib/utils'
import type { SubagentRun } from '@/hooks/useCodeSessions'
import { codeTurnsToUIMessages } from '@/lib/codeTurns'
import { MessageItem } from '@/containers/MessageItem'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'

/** One row in the running/finished lists. */
function TaskRow({
  run,
  needsInput,
  onSelect,
}: {
  run: SubagentRun
  needsInput: boolean
  onSelect: () => void
}) {
  const running = run.status === 'running'
  const { t } = useTranslation()
  // Only rendered for finished rows below — skip the scan while running (it
  // would just be recomputed and discarded on every tick/stream re-render).
  const toolUses = running
    ? 0
    : run.turns.filter((tn) => tn.role === 'tool').length
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col gap-1 rounded-lg border bg-main-view-fg/2 px-3 py-2.5 text-left hover:bg-main-view-fg/5"
    >
      <div className="flex items-center gap-2">
        {needsInput ? (
          <AlertCircle size={14} className="shrink-0 text-amber-500" />
        ) : running ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Sparkles size={14} className="shrink-0 text-main-view-fg/50" />
        )}
        <span className="truncate text-sm font-medium">{run.name}</span>
      </div>
      <span
        className={cn(
          'pl-6 font-mono text-xs tabular-nums',
          needsInput ? 'text-amber-500' : 'text-main-view-fg/50'
        )}
      >
        {needsInput
          ? t('common:needsInput')
          : `Agent · ${formatDuration(run.startedAt, run.endedAt)}`}
      </span>
      {!needsInput && !running && (
        <span className="pl-6 font-mono text-xs tabular-nums text-main-view-fg/50">
          {run.usage?.total_tokens
            ? `${formatTokenCount(run.usage.total_tokens)} tokens · `
            : ''}
          {toolUses} tool use{toolUses === 1 ? '' : 's'}
          {' · '}
          <span className="text-accent">{t('common:viewTranscript')}</span>
        </span>
      )}
    </button>
  )
}

/** The selected subagent's trace (live progress while running, full output when done). */
function TaskDetail({ run }: { run: SubagentRun }) {
  const {
    containerRef,
    isAtBottom,
    handleScroll,
    forceScrollToBottom,
  } = useAutoScroll()
  const messages = useMemo(() => {
    // Append the final answer (from await_subagent) as a closing assistant turn,
    // since it never arrives in the wrapped trace stream.
    const turns =
      run.finalOutput != null
        ? [...run.turns, { role: 'assistant' as const, content: run.finalOutput }]
        : run.turns
    return codeTurnsToUIMessages(turns, `sub-${run.runId}`)
  }, [run.turns, run.finalOutput, run.runId])
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-main-view-fg/50">
        {run.status === 'running'
          ? 'Working…'
          : 'The subagent produced no visible output.'}
      </div>
    )
  }
  return (
    <Conversation className="h-full text-start">
      <ConversationContent className="px-3">
        {messages.map((message, i) => (
          <MessageItem
            key={message.id}
            message={message as any}
            isFirstMessage={i === 0}
            isLastMessage={i === messages.length - 1}
            status={run.status === 'running' ? 'streaming' : 'ready'}
            reasoningContainerRef={containerRef}
            isReasoningAtBottom={isAtBottom}
            onReasoningScroll={handleScroll}
            onReasoningScrollToBottom={forceScrollToBottom}
          />
        ))}
      </ConversationContent>
    </Conversation>
  )
}

export function SubagentTasksPanel({
  subagents,
  awaitingInputRunIds,
  onClose,
}: {
  subagents: SubagentRun[]
  awaitingInputRunIds: Set<string>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Tick once a second while anything is running so the elapsed counters move.
  // Skipped while a detail view is open — that view doesn't render the
  // duration text, so ticking would just re-render the whole panel (including
  // the mounted transcript) for nothing.
  const [, tick] = useState(0)
  const anyRunning = subagents.some((s) => s.status === 'running')
  useEffect(() => {
    if (!anyRunning || selectedRunId) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [anyRunning, selectedRunId])

  const selected = selectedRunId
    ? subagents.find((s) => s.runId === selectedRunId) ?? null
    : null
  const runningRuns = subagents.filter((s) => s.status === 'running')
  const finishedRuns = subagents.filter((s) => s.status === 'done')

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-main-view">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {selected ? (
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="text-main-view-fg/60 hover:text-main-view-fg"
            aria-label={t('common:back')}
          >
            <ChevronLeft size={18} />
          </button>
        ) : null}
        <span className="flex-1 truncate text-sm font-medium">
          {selected ? selected.name : t('common:backgroundTasks')}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-main-view-fg/60 hover:text-main-view-fg"
          aria-label={t('common:close')}
        >
          <X size={18} />
        </button>
      </div>

      {selected ? (
        <div className="min-h-0 flex-1">
          <TaskDetail run={selected} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {subagents.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-main-view-fg/50">
              {t('common:noBackgroundTasks')}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {runningRuns.length > 0 && (
                <Section label={`${t('common:running')} ${runningRuns.length}`}>
                  {runningRuns.map((run) => (
                    <TaskRow
                      key={run.runId}
                      run={run}
                      needsInput={awaitingInputRunIds.has(run.runId)}
                      onSelect={() => setSelectedRunId(run.runId)}
                    />
                  ))}
                </Section>
              )}
              {finishedRuns.length > 0 && (
                <Section label={`${t('common:finished')} ${finishedRuns.length}`}>
                  {finishedRuns.map((run) => (
                    <TaskRow
                      key={run.runId}
                      run={run}
                      needsInput={false}
                      onSelect={() => setSelectedRunId(run.runId)}
                    />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={cn('px-1 text-xs font-medium uppercase tracking-wide text-main-view-fg/50')}>
        {label}
      </span>
      {children}
    </div>
  )
}
