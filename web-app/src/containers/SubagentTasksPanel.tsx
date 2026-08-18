/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronDown, Loader2, Sparkles, AlertCircle, Square } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, formatDuration, formatTokenCount } from '@/lib/utils'
import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'
import { codeTurnsToUIMessages } from '@/lib/codeTurns'
import { MessageItem } from '@/containers/MessageItem'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import { CodeSidePanel } from '@/containers/CodeSidePanel'

/** One row in the running/finished lists. */
function TaskRow({
  run,
  needsInput,
  onSelect,
  onCancel,
}: {
  run: SubagentRun
  needsInput: boolean
  onSelect: () => void
  onCancel?: () => void
}) {
  const running = run.status === 'running'
  const { t } = useTranslation()
  // Only rendered for finished rows below — skip the scan while running (it
  // would just be recomputed and discarded on every tick/stream re-render).
  const toolUses = running
    ? 0
    : run.turns.filter((tn) => tn.role === 'tool').length
  return (
    // A plain div (not <button>) because the cancel button below has to be a
    // real, independently-clickable <button> nested inside it — two nested
    // <button>s are invalid HTML and behave unpredictably on click/focus.
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="relative flex w-full cursor-pointer flex-col gap-1 rounded-lg border bg-main-view-fg/2 px-3 py-2.5 text-left hover:bg-main-view-fg/5"
    >
      {running && onCancel && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCancel()
          }}
          className="absolute right-2 top-2.5 rounded border border-main-view-fg/20 p-0.5 text-main-view-fg/50 hover:border-main-view-fg/40 hover:text-main-view-fg"
          aria-label={t('common:cancelSubagent')}
          title={t('common:cancelSubagent')}
        >
          <Square size={10} />
        </button>
      )}
      <div className="flex items-center gap-2 pr-6">
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
    </div>
  )
}

const LEGACY_TOOL_MARKUP =
  /<function_calls>[\s\S]*?(?:<\/function_calls>|$)/g

function visibleSubagentTurns(run: SubagentRun): CodeTurn[] {
  const last = run.turns.at(-1)
  const finalAlreadyStreamed =
    run.finalOutput != null &&
    last?.role === 'assistant' &&
    last.content === run.finalOutput
  const turns =
    run.finalOutput != null && !finalAlreadyStreamed
      ? [...run.turns, { role: 'assistant' as const, content: run.finalOutput }]
      : run.turns

  return turns.map((turn) =>
    turn.role === 'assistant' && turn.content.includes('<function_calls>')
      ? {
          ...turn,
          content: turn.content.replace(LEGACY_TOOL_MARKUP, '').trim(),
        }
      : turn,
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
  const messages = useMemo(
    () =>
      codeTurnsToUIMessages(visibleSubagentTurns(run), `sub-${run.runId}`),
    [run],
  )
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
  onCancel,
}: {
  subagents: SubagentRun[]
  awaitingInputRunIds: Set<string>
  onClose: () => void
  onCancel: (runId: string) => void
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
  const queuedRuns = subagents.filter((s) => s.status === 'queued')
  const finishedRuns = subagents.filter((s) => s.status === 'done')

  return (
    <CodeSidePanel
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
        <div className="h-full overflow-y-auto p-3">
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
                      needsInput={awaitingInputRunIds.has(run.runId)}
                      onSelect={() => setSelectedRunId(run.runId)}
                      onCancel={() => onCancel(run.runId)}
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
                      needsInput={false}
                      onSelect={() => setSelectedRunId(run.runId)}
                      onCancel={() => onCancel(run.runId)}
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
                      needsInput={false}
                      onSelect={() => setSelectedRunId(run.runId)}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </CodeSidePanel>
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
          className="px-1 text-xs font-medium uppercase tracking-wide text-main-view-fg/50 hover:text-main-view-fg/70 text-left"
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
