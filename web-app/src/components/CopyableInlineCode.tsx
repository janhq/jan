import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Streamdown tags single-line inline code with this attribute. We rely on it
// (rather than overriding the `code` component) so we don't disturb Streamdown's
// own rendering of fenced code blocks, which already ship their own copy button.
const INLINE_CODE_SELECTOR = '[data-streamdown="inline-code"]'
// How long the "Copied!" badge stays visible after a copy. ~1.2s reads as a
// clear confirmation without lingering over the text the user clicked.
const FEEDBACK_MS = 1200

type Badge = { x: number; y: number }

/**
 * Wraps rendered markdown and makes inline code (`like this`) click-to-copy,
 * showing a transient "Copied!" badge at the cursor.
 *
 * Uses event delegation + `display: contents` so it adds no layout box and does
 * not re-render the markdown body when the badge toggles.
 */
export function CopyableInlineCode({ children }: { children: React.ReactNode }) {
  const [badge, setBadge] = useState<Badge | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      INLINE_CODE_SELECTOR
    )
    if (!el) return

    // Don't hijack text selection: if the user dragged to select text, let them.
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return
    }

    const text = el.textContent ?? ''
    if (!text || !navigator.clipboard?.writeText) return

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setBadge({ x: e.clientX, y: e.clientY })
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setBadge(null), FEEDBACK_MS)
      })
      .catch(() => {
        // clipboard denied — silently do nothing
      })
  }, [])

  return (
    <div className="contents copyable-inline-code" onClick={handleClick}>
      {children}
      {badge &&
        createPortal(
          <div
            className={cn(
              'pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md px-2 py-1 text-xs font-medium shadow-md',
              'bg-foreground text-background animate-in fade-in-0 zoom-in-95'
            )}
            style={{ left: badge.x, top: badge.y - 8 }}
          >
            Copied!
          </div>,
          document.body
        )}
    </div>
  )
}
