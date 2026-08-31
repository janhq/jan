import { cloneElement, memo, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { IconArrowDown, IconCircleCheck } from '@tabler/icons-react'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@/components/ai-elements/chain-of-thought'
import {
  ReasoningActiveStep,
  StepRow,
} from '@/components/ai-elements/reasoning-timeline'
import { Button } from '@/components/ui/button'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import {
  findRunningToolCallId,
  useToolCallRuntime,
} from '@/hooks/useToolCallRuntime'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { segmentReasoningSteps } from '@/lib/reasoning'
import { ToolCallCard } from './ToolCallCard'
import { CONTENT_TYPE, isToolPart, type PartEntry } from './types'

export type ChainOfThoughtGroupProps = {
  /** Reasoning and tool parts belonging to this trace, in message order. */
  entries: PartEntry[]
  messageId: string
  /** Total parts on the message, used to detect the currently streaming part. */
  totalParts: number
  isStreaming: boolean
  /** An answer follows this trace, so it should auto-collapse. */
  hasFollowingContent: boolean
  /** Any tool on the message awaits approval; pins the trace open. */
  awaitingApproval: boolean
  citationOffsets: Map<number, number>
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  isReasoningAtBottom?: boolean
  onReasoningScroll?: () => void
  onReasoningScrollToBottom?: () => void
}

export const ChainOfThoughtGroup = memo(
  ({
    entries,
    messageId,
    totalParts,
    isStreaming,
    hasFollowingContent,
    awaitingApproval,
    citationOffsets,
    reasoningContainerRef,
    isReasoningAtBottom,
    onReasoningScroll,
    onReasoningScrollToBottom,
  }: ChainOfThoughtGroupProps) => {
    const { t } = useTranslation()
    const pendingApprovals = useToolApprovalRequests((s) => s.pending)
    const runningToolCallId = useToolCallRuntime((s) => findRunningToolCallId(s.timings))
    const [view, setView] = useState<'condensed' | 'extended'>('condensed')

    if (entries.length === 0) return null

    const hasTools = entries.some((e) => isToolPart(e.part))

    const lastEntryIndex = entries[entries.length - 1].index
    const groupIsStreaming = isStreaming && lastEntryIndex === totalParts - 1
    // The extended timeline only exists while streaming; once the turn ends the
    // full rail is what renders anyway.
    const isExtended = groupIsStreaming && view === 'extended'

    // While streaming, surface only the latest step (current reasoning
    // paragraph or tool call) so each step replaces the previous one rather
    // than the whole trace scrolling by. The full trace renders once done.
    const isMeaningfulEntry = ({ part }: PartEntry) => {
      if (part.type === CONTENT_TYPE.REASONING) {
        return Boolean(part.text && part.text.trim())
      }
      return isToolPart(part)
    }
    const meaningful = entries.filter(isMeaningfulEntry)
    // Tools execute one at a time, so with several calls in a turn the last
    // part is the one at the back of the queue. Follow the call actually doing
    // the work; before execution starts nothing is running and the newest part
    // is still the right thing to show as it streams in.
    const running = runningToolCallId
      ? meaningful.find((e) => e.part.toolCallId === runningToolCallId)
      : undefined
    const lastMeaningful = running ?? meaningful[meaningful.length - 1]
    // While streaming, show only the current step — but never truncate away a
    // tool part that is awaiting the user's approval, or its approve/deny
    // controls would never mount and the run would hang (multi-tool turns).
    const visibleEntries =
      groupIsStreaming && meaningful.length > 0
        ? meaningful.filter((e) => {
            if (e === lastMeaningful) return true
            const toolCallId = e.part.toolCallId
            return Boolean(toolCallId && pendingApprovals[toolCallId])
          })
        : entries

    // Streaming label reflects the current step, not whether the whole trace
    // ever used a tool — otherwise it sticks on "Using tools…" once the model
    // resumes reasoning after a tool call.
    const currentStepIsTool = Boolean(
      lastMeaningful && isToolPart(lastMeaningful.part)
    )

    // While streaming, expand for a tool call -- its card carries the live
    // search/address bar and the result, all of which sit inside this
    // collapsible -- or for reasoning that has a settled step to show, i.e. the
    // trace has advanced past its first step. Once done, any reasoning text
    // qualifies. An answer following the trace still collapses it, so the card
    // does not linger once the model moves on.
    const hasDisplayableContent = groupIsStreaming
      ? currentStepIsTool ||
        (lastMeaningful?.part.type === CONTENT_TYPE.REASONING &&
          segmentReasoningSteps(lastMeaningful.part.text ?? '').length >= 2)
      : entries.some(
          (e) =>
            e.part.type === CONTENT_TYPE.REASONING &&
            Boolean(e.part.text && e.part.text.trim())
        )

    // Pinned open while a tool awaits approval — its approve/deny controls live
    // inside the collapsible and must stay mounted even if an answer has
    // started. The extended view always has the live step to show, so it must
    // not be collapsed out from under the reader who just opened it.
    const shouldCollapse =
      hasFollowingContent || !(hasDisplayableContent || isExtended)

    // Done/historical: flatten every entry (reasoning paragraphs, tool calls)
    // into steps on a single continuous dotted rail, so a tool call between two
    // reasoning paragraphs stays threaded instead of restarting the rail.
    // `live` keeps the in-progress step as the trailing row and drops the Done
    // marker, so the same rail serves the extended streaming view.
    const renderTimeline = (rows: PartEntry[], live: boolean) => {
      const steps: React.ReactNode[] = []
      for (const { part, index: partIndex } of rows) {
        if (part.type === CONTENT_TYPE.REASONING) {
          const text = part.text ?? ''
          const segments = segmentReasoningSteps(text)
          const isLivePart = live && partIndex === totalParts - 1
          const settled = isLivePart ? segments.slice(0, -1) : segments
          for (const [pi, para] of settled.entries()) {
            steps.push(
              <StepRow key={`${messageId}-r-${partIndex}-${pi}`} text={para} />
            )
          }
          if (isLivePart && segments.length > 0) {
            steps.push(
              <StepRow key={`${messageId}-rl-${partIndex}`}>
                <ReasoningActiveStep text={text} mode="live" />
              </StepRow>
            )
          }
          continue
        }
        if (isToolPart(part)) {
          steps.push(
            <StepRow key={`${messageId}-t-${partIndex}`}>
              <ToolCallCard
                part={part}
                messageId={messageId}
                citationOffset={citationOffsets.get(partIndex) ?? 0}
                className="mb-1"
              />
            </StepRow>
          )
        }
      }
      if (steps.length === 0) return null
      if (!live) {
        steps.push(
          <StepRow
            key={`${messageId}-done`}
            marker={
              <IconCircleCheck className="size-4 text-muted-foreground/60" />
            }
            text={t('chat:done')}
          />
        )
      }
      return (
        <ol className="relative flex flex-col gap-2.5">
          {steps.map((step, i) =>
            step && typeof step === 'object' && 'props' in step
              ? cloneElement(step as React.ReactElement<{ connector?: boolean }>, {
                  connector: i < steps.length - 1,
                })
              : step
          )}
        </ol>
      )
    }

    // Auto-followed viewport: the parent's scroll hook keeps it pinned to the
    // newest content until the reader scrolls up.
    const autoFollowBox = (content: React.ReactNode, maxHeight: string) => (
      <div className="relative">
        <div
          ref={reasoningContainerRef}
          onScroll={onReasoningScroll}
          className={twMerge(
            'w-full overflow-auto relative',
            maxHeight,
            '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
          )}
        >
          {content}
        </div>
        {!isReasoningAtBottom && (
          <Button
            className="absolute bottom-2 left-[50%] translate-x-[-50%] rounded-full size-7 z-10"
            onClick={onReasoningScrollToBottom}
            size="icon"
            type="button"
            variant="outline"
          >
            <IconArrowDown className="size-3" />
          </Button>
        )}
      </div>
    )

    // Condensed: the settled step only, so the text does not shift mid-read.
    // 5 lines of text-sm (1.25rem line-height).
    const renderCondensed = () =>
      visibleEntries.map(({ part, index: partIndex }) => {
        if (part.type === CONTENT_TYPE.REASONING) {
          if (partIndex !== totalParts - 1) return null
          return (
            <div key={`${messageId}-r-${partIndex}`}>
              {autoFollowBox(
                <ReasoningActiveStep text={part.text ?? ''} />,
                'max-h-[6.25rem]'
              )}
            </div>
          )
        }

        return (
          <ToolCallCard
            key={`${messageId}-t-${partIndex}`}
            part={part}
            messageId={messageId}
            citationOffset={citationOffsets.get(partIndex) ?? 0}
            className="mb-1"
          />
        )
      })

    return (
      <ChainOfThought
        className="w-full text-muted-foreground"
        isStreaming={groupIsStreaming}
        shouldCollapse={shouldCollapse}
        forceOpen={awaitingApproval}
        defaultOpen={hasDisplayableContent && !hasFollowingContent}
      >
        <ChainOfThoughtHeader
          // The tool card rendered right below names the call, its origin and
          // its elapsed time, so repeating the tool here printed it twice one
          // row apart. This row speaks for the trace, not the step.
          streamingLabel={
            currentStepIsTool
              ? t('chat:reasoning.working')
              : t('chat:reasoning.thinking')
          }
          completedVariant={hasTools ? 'worked' : 'thought'}
          navDirection={
            groupIsStreaming ? (isExtended ? 'left' : 'right') : undefined
          }
          onNavigate={() => setView(isExtended ? 'condensed' : 'extended')}
        />
        <ChainOfThoughtContent>
          {!groupIsStreaming
            ? renderTimeline(entries, false)
            : isExtended
              ? autoFollowBox(renderTimeline(entries, true), 'max-h-80')
              : renderCondensed()}
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
  }
)

ChainOfThoughtGroup.displayName = 'ChainOfThoughtGroup'
