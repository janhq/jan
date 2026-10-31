import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Shared border-edge geometry for message rows and the fixed composer. */
export const conversationColumnClassName =
  'mx-auto w-full max-w-[880px] px-4 md:px-6'

type ConversationColumnProps = ComponentProps<'div'> & {
  reserveScrollGutter?: boolean
}

export function ConversationColumn({
  className,
  reserveScrollGutter = false,
  ...props
}: ConversationColumnProps) {
  const column = (
    <div className={cn(conversationColumnClassName, className)} {...props} />
  )

  // Match StickToBottom.Content's scroll viewport, including classic scrollbars.
  // `hidden` reserves native stable gutters without adding another scrollbar;
  // overlay-scrollbar platforms naturally reserve no space. Keep this outside
  // the max-width column: gutters reduce the available width BEFORE capping it.
  return reserveScrollGutter ? (
    <div
      className="w-full shrink-0"
      style={{ overflowY: 'hidden', scrollbarGutter: 'stable both-edges' }}
    >
      {column}
    </div>
  ) : column
}
