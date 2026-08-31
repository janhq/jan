/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, formatDuration, formatTokenCount } from '@/lib/utils'
import type { CoworkTurn, SubagentRun } from '@/types/coworkSession'
import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import { MessageItem } from '@/containers/MessageItem'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import { CoworkSidePanel } from '@/containers/CoworkSidePanel'

/** One row in the running/queued/finished lists. */
function TaskRow({ run, onSelect }: { run: SubagentRun; onSelect: () => void }) {
  const { t } = useTranslation()
  const running = run.status === 'running'
  // Only rendered for finished rows below — skip the scan while running (it
  // would just be recomputed and discarded on every tick/stream re-render).
  const toolUses = running
    ? 0
    : run.turns.filter((tn) => tn.role === 'tool').length
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border bg-main-view-fg/2 px-3 py-2.5 text-left hover:bg-main-view-fg/5"
    >
      <div className="flex items-center gap-2">
        {running ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Sparkles size={14} className="shrink-0 text-main-view-fg/50" />
        )}
        <span className="truncate text-sm font-medium">{run.name}</span>
      </div>
      <span className="pl-6 font-mono text-xs tabular-nums text-main-view-fg/50">
        {formatDuration(run.startedAt, run.endedAt)}
      </span>
      {!running && run.status === 'done' && (
        <span className="pl-6 font-mono text-xs tabular-nums text-main-view-fg/50">
          {run.usage?.total_tokens
            ? `${formatTokenCount(run.usage.total_tokens)} · `
            : ''}
          {t('common:subagentToolUses', { count: toolUses })}
          {' · '}
          <span className="text-accent">{t('common:viewTranscript')}</span>
        </span>
      )}
    </button>
  )
}

/** The run's trace plus its final answer, unless that answer already streamed
 * as the last assistant turn — appending it again would show it twice. */
function visibleSubagentTurns(run: SubagentRun): CoworkTurn[] {
  const last = run.turns.at(-1)
  const finalAlreadyStreamed =
    run.finalOutput != null &&
    last?.role === 'assistant' &&
    last.content === run.finalOutput
  return run.finalOutput != null && !finalAlreadyStreamed
    ? [...run.turns, { role: 'assistant' as const, content: run.finalOutput }]
    : run.turns
}

/** The selected subagent's trace (live progress while running, full output when done). */
function TaskDetail({ run }: { run: SubagentRun }) {
  const { t } = useTranslation()
  const { containerRef, isAtBottom, handleScroll, forceScrollToBottom } =
    useAutoScroll()
  const messages = useMemo(
    () => coworkTurnsToUIMessages(visibleSubagentTurns(run), `sub-${run.runId}`),
    [run]
  )
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-main-view-fg/50">
        {run.status === 'running'
          ? t('common:taskWorking')
          : t('common:taskNoOutput')}
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

function Section({
  label,
  count,
  collapsible = false,
  children,
}: {
  label: string
  count: number
  collapsible?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const labelRow = (
    <span className="flex items-center gap-1">
      {label} {count}
      {collapsible && (
        <ChevronDown
          size={12}
          className={cn('transition-transform', !open && '-rotate-90')}
        />
      )}
    </span>
  )
  return (
    <div className="flex flex-col gap-2">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="px-1 text-left text-xs font-medium uppercase tracking-wide text-main-view-fg/50 hover:text-main-view-fg/70"
        >
          {labelRow}
        </button>
      ) : (
        <span className="px-1 text-xs font-medium uppercase tracking-wide text-main-view-fg/50">
          {labelRow}
        </span>
      )}
      {(!collapsible || open) && children}
    </div>
  )
}

/**
 * Background subagent runs for the viewed session: queued and running ones
 * live in useCoworkRun while a run streams, finished ones persist on the
 * session. Selecting a row opens its own transcript in place.
 */
export function CoworkTasksPanel({
  subagents,
  onClose,
}: {
  subagents: SubagentRun[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Tick once a second while anything is running so the elapsed counters move.
  // Skipped while a detail view is open — that view doesn't render the
  // duration text, so ticking would just re-render the mounted transcript.
  const [, tick] = useState(0)
  const anyRunning = subagents.some((s) => s.status === 'running')
  useEffect(() => {
    if (!anyRunning || selectedRunId) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [anyRunning, selectedRunId])

  const selected = selectedRunId
    ? (subagents.find((s) => s.runId === selectedRunId) ?? null)
    : null
  const runningRuns = subagents.filter((s) => s.status === 'running')
  const queuedRuns = subagents.filter((s) => s.status === 'queued')
  const finishedRuns = subagents.filter((s) => s.status === 'done')

  return (
    <CoworkSidePanel
      title={selected ? selected.name : t('common:backgroundTasks')}
      leading={
        selected ? (
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="text-main-view-fg/60 hover:text-main-view-fg"
            aria-label={t('common:back')}
          >
            <ChevronLeft size={18} />
          </button>
        ) : undefined
      }
      onClose={onClose}
    >
      {selected ? (
        <TaskDetail run={selected} />
      ) : (
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
          {subagents.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-main-view-fg/50">
              {t('common:noBackgroundTasks')}
            </p>
          ) : (
            <>
              {runningRuns.length > 0 && (
                <Section label={t('common:running')} count={runningRuns.length}>
                  {runningRuns.map((run) => (
                    <TaskRow
                      key={run.runId}
                      run={run}
                      onSelect={() => setSelectedRunId(run.runId)}
                    />
                  ))}
                </Section>
              )}
              {queuedRuns.length > 0 && (
                <Section label={t('common:queued')} count={queuedRuns.length}>
                  {queuedRuns.map((run) => (
                    <TaskRow
                      key={run.runId}
                      run={run}
                      onSelect={() => setSelectedRunId(run.runId)}
                    />
                  ))}
                </Section>
              )}
              {finishedRuns.length > 0 && (
                <Section
                  label={t('common:finished')}
                  count={finishedRuns.length}
                  collapsible
                >
                  {finishedRuns.map((run) => (
                    <TaskRow
                      key={run.runId}
                      run={run}
                      onSelect={() => setSelectedRunId(run.runId)}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </CoworkSidePanel>
  )
}
