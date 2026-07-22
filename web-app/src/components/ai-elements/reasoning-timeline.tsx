import { memo } from 'react'
import type React from 'react'
import { cn } from '@/lib/utils'
import { splitReasoningParagraphs } from '@/lib/reasoning'

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

/**
 * While reasoning streams, show only the most recently *completed* paragraph as
 * plain text — never the paragraph currently being written. As the model
 * finishes each paragraph and starts the next, the derived last-completed
 * paragraph swaps, so exactly one bounded block is visible at a time instead of
 * the whole growing trace.
 */
export const ReasoningActiveStep = memo(({ text }: { text: string }) => {
  const steps = splitReasoningParagraphs(text)
  // The final element is the in-progress paragraph; the one before it is the
  // last paragraph the model has actually finished.
  const completed = steps.slice(0, -1)
  const current = completed[completed.length - 1] ?? ''
  if (!current) return null
  // Key by paragraph index so each swap remounts the block, replaying the
  // fade/collapse enter transition as one paragraph gives way to the next.
  return (
    <div
      key={completed.length}
      dir="auto"
      className={cn(
        'select-text whitespace-pre-wrap wrap-break-word text-sm text-main-view-fg/70',
        'animate-in fade-in-0 slide-in-from-top-1 duration-300 ease-out'
      )}
    >
      {current}
    </div>
  )
})

ReasoningActiveStep.displayName = 'ReasoningActiveStep'
