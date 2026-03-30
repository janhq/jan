import { useRef, useCallback, useState } from 'react'

// How close to the bottom (in px) counts as "at the bottom"
const BOTTOM_THRESHOLD = 20

/**
 * Auto-scrolls a container to bottom as content streams in, but pauses
 * when the user scrolls up to read. Resumes once they scroll back down.
 */
export function useAutoScroll() {
  const containerRef = useRef<HTMLDivElement>(null)
  const isStuckRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  // Update stuck state whenever the user (or programmatic) scrolls
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const stuck =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
    isStuckRef.current = stuck
    setIsAtBottom(stuck)
  }, [])

  // Scroll to bottom only when the user hasn't scrolled away
  const scrollToBottom = useCallback(() => {
    if (isStuckRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [])

  // Force-scroll to bottom regardless of stuck state (for the button)
  const forceScrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
    isStuckRef.current = true
    setIsAtBottom(true)
  }, [])

  // Re-enable auto-scroll (e.g. when a new streaming session begins)
  const reset = useCallback(() => {
    isStuckRef.current = true
    setIsAtBottom(true)
  }, [])

  return {
    containerRef,
    isAtBottom,
    handleScroll,
    scrollToBottom,
    forceScrollToBottom,
    reset,
  }
}
