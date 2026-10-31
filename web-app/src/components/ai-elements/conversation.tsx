/* eslint-disable react-refresh/only-export-components */
import { Button } from '@/components/ui/button'
import { conversationColumnClassName } from './conversation-column'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { IconArrowDown } from '@tabler/icons-react'
import type { ComponentProps } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  memo,
} from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'

export type ConversationProps = ComponentProps<typeof StickToBottom>

// Lets content release the stick-to-bottom lock. Outside any Conversation
// there is no lock, so the default is a no-op.
const ReleaseScrollLockContext = createContext<() => void>(() => {})

/** Call before a user-driven size change (expanding a trace, say): while
 * locked, the library re-pins to the bottom on every resize, which would carry
 * the expanded content up and out of view. */
export const useReleaseScrollLock = () => useContext(ReleaseScrollLockContext)

export const Conversation = memo(
  ({ className, children, ...props }: ConversationProps) => (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    >
      {/* The render callback hands over the library context directly, so
          stopScroll needs no ref, and function children keep working. */}
      {(context) => (
        <ReleaseScrollLockContext.Provider value={context.stopScroll}>
          {typeof children === 'function' ? children(context) : children}
        </ReleaseScrollLockContext.Provider>
      )}
    </StickToBottom>
  )
)

Conversation.displayName = 'Conversation'

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content> & {
  column?: boolean
}

export const ConversationContent = memo(({ className, column = false, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn(
      'flex flex-col gap-x-8 gap-y-2',
      column ? conversationColumnClassName : 'px-2',
      className
    )}
    {...props}
  />
))

ConversationContent.displayName = 'ConversationContent'

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string
  description?: string
  icon?: React.ReactNode
}

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
)

export type ConversationScrollButtonProps = ComponentProps<typeof Button>

/** Opaque and raised: the outline variant is translucent in dark mode, and the
 * page surface alone made the button blend in. Shared with the in-trace
 * scroll button so both read the same. */
export const scrollToBottomButtonClassName =
  'rounded-full bg-background text-foreground shadow-lg hover:bg-accent dark:border-input dark:bg-secondary dark:hover:bg-secondary dark:hover:brightness-125'

/** Within this many px of an edge, nothing is clipped there (sub-pixel scroll
 * positions never land exactly on 0). */
const EDGE_EPSILON_PX = 1

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { t } = useTranslation()
  const { isAtBottom, scrollToBottom, scrollRef, contentRef, state } =
    useStickToBottomContext()

  // The fades follow the real edges, measured here. The library's isAtBottom
  // also counts the last 70px as "at bottom", which would drop the bottom fade
  // while a sliver is still clipped; it stays the button's cue only.
  const [edges, setEdges] = useState({ top: true, bottom: true })
  const boundRef = useRef<HTMLElement | null>(null)
  const unbindRef = useRef<(() => void) | null>(null)
  // No deps: re-checked every render so a remounted scroll element is picked
  // up (scrollRef itself is stable and never re-triggers an effect).
  useEffect(() => {
    const el = scrollRef.current
    if (el === boundRef.current) return
    unbindRef.current?.()
    unbindRef.current = null
    boundRef.current = el
    if (!el) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const update = () => {
      const top = el.scrollTop <= EDGE_EPSILON_PX
      // While pinned, each streamed chunk is followed by a spring back to the
      // bottom that leaves a gap for a few frames; that is not "clipped", so
      // an in-flight animation counts as at bottom and the fade stays off.
      // The library clears the animation without firing any event we hear
      // (e.g. when an upward scroll interrupts it), so keep re-checking each
      // frame until it is gone and the real edge can be measured.
      const animating = Boolean(state.animation)
      if (animating) schedule()
      // So does a growth the library is about to follow: it records
      // resizeDifference in its observer but starts the animation a frame
      // later. (Not the bare lock state: that is also true when the reader
      // stops within 70px of the bottom, where content really is clipped.)
      const following = state.isAtBottom && state.resizeDifference > 0
      const bottom =
        animating ||
        following ||
        el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_EPSILON_PX
      setEdges((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom }
      )
    }
    update()
    // Both checks run a frame later. In a frame, scroll events fire before
    // resize observers, and the library starts its spring in its observer, so
    // reading straight away sees newly streamed content as a bare gap.
    el.addEventListener('scroll', schedule, { passive: true })
    // Streaming text and a resized window change the edges without a scroll.
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    if (contentRef.current) observer.observe(contentRef.current)
    unbindRef.current = () => {
      el.removeEventListener('scroll', schedule)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  })
  // Forget the bound element too: StrictMode and Fast Refresh unmount and
  // remount effects in place, and the remount must bind again.
  useEffect(
    () => () => {
      unbindRef.current?.()
      unbindRef.current = null
      boundRef.current = null
    },
    []
  )

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])

  return (
    <>
      {/* Mirrors the bottom fade below: text slides out under the header
          instead of being cut at its edge. Hidden at the top so the first
          message is never dimmed. Both fades end in the surface the app layout
          paints behind the chat (background in both light and dark themes), so
          neither shows as a band, and ease in (40% at the midpoint) so the
          dimming starts gently instead of as a straight ramp. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-t from-transparent via-background/40 via-50% to-background transition-opacity duration-200',
          edges.top ? 'opacity-0' : 'opacity-100'
        )}
      />
      {/* Fades text into the page surface above the composer instead of
          clipping it at a hard edge. Only while scrolled up: at the bottom the
          last line is the newest content and must stay fully legible. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent via-background/40 via-50% to-background transition-opacity duration-200',
          edges.bottom ? 'opacity-0' : 'opacity-100'
        )}
      />
      {!isAtBottom && (
        <Button
          className={cn(
            'absolute bottom-4 left-[50%] translate-x-[-50%]',
            scrollToBottomButtonClassName,
            className
          )}
          onClick={handleScrollToBottom}
          size="icon"
          type="button"
          variant="outline"
          aria-label={t('common:scrollToBottom')}
          title={t('common:scrollToBottom')}
          {...props}
        >
          <IconArrowDown className="size-4" aria-hidden="true" />
        </Button>
      )}
    </>
  )
}
