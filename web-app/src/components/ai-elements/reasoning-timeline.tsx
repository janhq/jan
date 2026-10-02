import { memo } from 'react'
import type React from 'react'
import { cn } from '@/lib/utils'
import { segmentReasoningSteps } from '@/lib/reasoning'

type StepRowProps = {
  text?: string
  connector?: boolean
  children?: React.ReactNode
  marker?: React.ReactNode
}

/**
 * One step on the dotted timeline rail: a dot plus content, with an optional
 * dotted connector descending to the next step. Pass `text` for a plain
 * reasoning paragraph, or `children` to host arbitrary content (e.g. a tool
 * call) on the same continuous rail.
 */
export const StepRow = ({
  text,
  connector = false,
  children,
  marker,
}: StepRowProps) => (
  <li className="relative flex gap-2.5">
    {connector && (
      <span className="absolute left-[3px] top-3.5 -bottom-2.5 border-l border-dotted border-border" />
    )}
    {marker ? (
      <span className="relative z-10 mt-1.5 flex size-1.5 shrink-0 items-center justify-center">
        <span className="absolute flex items-center justify-center">
          {marker}
        </span>
      </span>
    ) : (
      <span className="relative z-10 mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
    )}
    {children ? (
      <div className="min-w-0 flex-1">{children}</div>
    ) : (
      <div
        dir="auto"
        className="select-text whitespace-pre-wrap wrap-break-word text-sm text-main-view-fg/70"
      >
        {text}
      </div>
    )}
  </li>
)

export type ReasoningStepMode = 'settled' | 'live'

/**
 * One bounded block of a streaming reasoning trace, rather than the whole
 * growing text. `settled` shows the last step the model actually finished, so
 * the condensed view does not shift under the reader; `live` shows the step
 * being written, so tokens appear as they arrive. Steps are budget-bounded, so
 * either mode advances even when the model never emits a paragraph break.
 */
export const ReasoningActiveStep = memo(
  ({ text, mode = 'settled' }: { text: string; mode?: ReasoningStepMode }) => {
    const steps = segmentReasoningSteps(text)
    // The final element is always the step in progress.
    const index = mode === 'live' ? steps.length - 1 : steps.length - 2
    const current = index >= 0 ? steps[index] : undefined
    if (!current) return null
    // Key by step index so each swap remounts the block, replaying the
    // fade/collapse enter transition as one step gives way to the next. A step
    // keeps its key while it grows, so it is not remounted on every token.
    return (
      <div
        key={index}
        dir="auto"
        className={cn(
          'select-text whitespace-pre-wrap wrap-break-word text-sm text-main-view-fg/70',
          'animate-in fade-in-0 slide-in-from-top-1 duration-300 ease-out'
        )}
      >
        {current}
      </div>
    )
  }
)

ReasoningActiveStep.displayName = 'ReasoningActiveStep'
