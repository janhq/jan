import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from './useAppState'
import { useMessages } from './useMessages'
import { useInterfaceSettings } from './useInterfaceSettings'
import { THREAD_SCROLL_BEHAVIOR } from '@/constants/threadScroll'

const VIEWPORT_PADDING = 40 // Offset from viewport bottom for user message positioning
const MAX_DOM_RETRY_ATTEMPTS = 5 // Maximum attempts to find DOM elements before giving up
const DOM_RETRY_DELAY = 100 // Delay in ms between DOM element retry attempts

export const useThreadScrolling = (
  threadId: string,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
) => {
  const streamingContent = useAppState((state) => state.streamingContent)
  const isFirstRender = useRef(true)
  const wasStreamingRef = useRef(false)
  const userIntendedPositionRef = useRef<number | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasScrollbar, setHasScrollbar] = useState(false)
  const lastScrollTopRef = useRef(0)
  const lastAssistantMessageRef = useRef<HTMLElement | null>(null)
  const userForcedUnfollowRef = useRef(false)
  const stickyStreamingActiveRef = useRef(false)
  const stickyReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasAtBottomRef = useRef(true)
  const threadScrollBehavior = useInterfaceSettings(
    (state) => state.threadScrollBehavior
  )
  const isFlowScroll = threadScrollBehavior === THREAD_SCROLL_BEHAVIOR.FLOW
  const isStickyScroll = threadScrollBehavior === THREAD_SCROLL_BEHAVIOR.STICKY
  const [isStickyScrollFollowing, setIsStickyScrollFollowing] = useState(true)

  const messageCount = useMessages((state) => state.messages[threadId]?.length ?? 0)
  const lastMessageRole = useMessages((state) => {
    const msgs = state.messages[threadId]
    return msgs && msgs.length > 0 ? msgs[msgs.length - 1].role : null
  })

  const [paddingHeight, setPaddingHeightInternal] = useState(0)
  const setPaddingHeight = setPaddingHeightInternal
  const originalPaddingRef = useRef(0)

  const getDOMElements = useCallback(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return null

    const userMessages = scrollContainer.querySelectorAll('[data-message-author-role="user"]')
    const assistantMessages = scrollContainer.querySelectorAll('[data-message-author-role="assistant"]')
    return {
      scrollContainer,
      lastUserMessage: userMessages[userMessages.length - 1] as HTMLElement,
      lastAssistantMessage: assistantMessages[assistantMessages.length - 1] as HTMLElement,
    }
  }, [scrollContainerRef])


  const showScrollToBottomBtn =
    !isAtBottom && hasScrollbar && (!isStickyScroll || !isStickyScrollFollowing)

  const clearStickyReleaseTimeout = useCallback(() => {
    if (stickyReleaseTimeoutRef.current) {
      clearTimeout(stickyReleaseTimeoutRef.current)
      stickyReleaseTimeoutRef.current = null
    }
  }, [])

  const scrollToBottom = useCallback(
    (smooth = false) => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          ...(smooth ? { behavior: 'smooth' } : {}),
        })

        if (isStickyScroll) {
          clearStickyReleaseTimeout()
          userForcedUnfollowRef.current = false
          setIsStickyScrollFollowing(true)
        }
      }
    },
    [clearStickyReleaseTimeout, isStickyScroll, scrollContainerRef]
  )


  const handleScroll = useCallback(
    (e: Event) => {
      const target = e.target as HTMLDivElement
      const { scrollTop, scrollHeight, clientHeight } = target
      const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
      const hasScroll = scrollHeight > clientHeight
      const previousScrollTop = lastScrollTopRef.current
      const delta = scrollTop - previousScrollTop
      const wasAtBottom = wasAtBottomRef.current

      if (Math.abs(delta) > 10) {
        if (streamingContent && !isBottom) {
          userIntendedPositionRef.current = scrollTop
        }

        if (isStickyScroll) {
          if (!isBottom && delta < 0) {
            clearStickyReleaseTimeout()
            userForcedUnfollowRef.current = true
            setIsStickyScrollFollowing((prev) => {
              if (!prev) return prev
              return false
            })
          }
        }
      }

      if (isStickyScroll) {
        if (!isBottom && delta < -1) {
          clearStickyReleaseTimeout()
          userForcedUnfollowRef.current = true
          setIsStickyScrollFollowing((prev) => {
            if (!prev) return prev
            return false
          })
        } else if (isBottom && (!wasAtBottom || !isStickyScrollFollowing)) {
          clearStickyReleaseTimeout()
          userForcedUnfollowRef.current = false
          setIsStickyScrollFollowing((prev) => {
            if (prev) return prev
            return true
          })
        }
      }

      setIsAtBottom(isBottom)
      setHasScrollbar(hasScroll)
      lastScrollTopRef.current = scrollTop
      wasAtBottomRef.current = isBottom
    },
    [
      clearStickyReleaseTimeout,
      isStickyScroll,
      isStickyScrollFollowing,
      streamingContent,
    ]
  )

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll)
      return () =>
        scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll, scrollContainerRef])

  const checkScrollState = useCallback(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    const hasScroll = scrollHeight > clientHeight

    setIsAtBottom(isBottom)
    setHasScrollbar(hasScroll)
  }, [scrollContainerRef])

  useEffect(() => {
    if (!scrollContainerRef.current) return
    if (isFirstRender.current) {
      isFirstRender.current = false
      userIntendedPositionRef.current = null
      wasStreamingRef.current = false
      scrollToBottom(false)
      checkScrollState()
    }
  }, [checkScrollState, scrollToBottom, scrollContainerRef])

  const prevCountRef = useRef(messageCount)
  useEffect(() => {
    if (!isFlowScroll) {
      prevCountRef.current = messageCount
      return
    }
    const prevCount = prevCountRef.current
    const becameLonger = messageCount > prevCount
    const isUserMessage = lastMessageRole === 'user'

    if (becameLonger && messageCount > 0 && isUserMessage) {
      const calculatePadding = () => {
        const elements = getDOMElements()
        if (!elements?.lastUserMessage) return

        const viewableHeight = elements.scrollContainer.clientHeight
        const userMessageHeight = elements.lastUserMessage.offsetHeight
        const calculatedPadding = Math.max(0, viewableHeight - VIEWPORT_PADDING - userMessageHeight)

        setPaddingHeight(calculatedPadding)
        originalPaddingRef.current = calculatedPadding

        // Scroll after padding is applied to the DOM
        requestAnimationFrame(() => {
          elements.scrollContainer.scrollTo({
            top: elements.scrollContainer.scrollHeight,
            behavior: 'smooth',
          })
        })
      }

      let retryCount = 0

      const tryCalculatePadding = () => {
        if (getDOMElements()?.lastUserMessage) {
          calculatePadding()
        } else if (retryCount < MAX_DOM_RETRY_ATTEMPTS) {
          retryCount++
          setTimeout(tryCalculatePadding, DOM_RETRY_DELAY)
        }
      }

      tryCalculatePadding()
    }

    prevCountRef.current = messageCount
  }, [isFlowScroll, lastMessageRole, messageCount, getDOMElements, setPaddingHeight])

  useEffect(() => {
    const previouslyStreaming = wasStreamingRef.current
    const currentlyStreaming = !!streamingContent && streamingContent.thread_id === threadId

    if (!isFlowScroll) {
      wasStreamingRef.current = currentlyStreaming
      return
    }

    const streamingStarted = !previouslyStreaming && currentlyStreaming
    const streamingEnded = previouslyStreaming && !currentlyStreaming
    const hasPaddingToAdjust = originalPaddingRef.current > 0

    // Store the current assistant message when streaming starts
    if (streamingStarted) {
      const elements = getDOMElements()
      lastAssistantMessageRef.current = elements?.lastAssistantMessage || null
    }

    if (streamingEnded && hasPaddingToAdjust) {
      let retryCount = 0

      const adjustPaddingWhenReady = () => {
        const elements = getDOMElements()
        const currentAssistantMessage = elements?.lastAssistantMessage

        // Check if a new assistant message has appeared (different from the one before streaming)
        const hasNewAssistantMessage = currentAssistantMessage &&
          currentAssistantMessage !== lastAssistantMessageRef.current

        if (hasNewAssistantMessage && elements?.lastUserMessage) {
          const userRect = elements.lastUserMessage.getBoundingClientRect()
          const assistantRect = currentAssistantMessage.getBoundingClientRect()
          const actualSpacing = assistantRect.top - userRect.bottom
          const totalAssistantHeight = currentAssistantMessage.offsetHeight + actualSpacing
          const newPadding = Math.max(0, originalPaddingRef.current - totalAssistantHeight)

          setPaddingHeight(newPadding)
          originalPaddingRef.current = newPadding
          lastAssistantMessageRef.current = currentAssistantMessage
        } else if (retryCount < MAX_DOM_RETRY_ATTEMPTS) {
          retryCount++
          setTimeout(adjustPaddingWhenReady, DOM_RETRY_DELAY)
        } else {
          // Max retries hit - remove padding as fallback
          setPaddingHeight(0)
          originalPaddingRef.current = 0
        }
      }

      adjustPaddingWhenReady()
    }

    wasStreamingRef.current = currentlyStreaming
  }, [getDOMElements, isFlowScroll, streamingContent, threadId, setPaddingHeight])

  useEffect(() => {
    if (isFlowScroll) return
    setPaddingHeight(0)
    originalPaddingRef.current = 0
  }, [isFlowScroll, setPaddingHeight])

  useEffect(() => {
    if (!isStickyScroll) {
      stickyStreamingActiveRef.current = false
      clearStickyReleaseTimeout()
      return
    }

    const isCurrentThreadStreaming =
      !!streamingContent && streamingContent.thread_id === threadId

    if (isCurrentThreadStreaming) {
      if (!stickyStreamingActiveRef.current) {
        stickyStreamingActiveRef.current = true
      }
      clearStickyReleaseTimeout()
      if (!userForcedUnfollowRef.current) {
        setIsStickyScrollFollowing((prev) => {
          if (prev) return prev
          return true
        })
      }
    } else if (stickyStreamingActiveRef.current) {
      stickyStreamingActiveRef.current = false
      clearStickyReleaseTimeout()
      if (isStickyScrollFollowing) {
        stickyReleaseTimeoutRef.current = setTimeout(() => {
          stickyReleaseTimeoutRef.current = null
          setIsStickyScrollFollowing((prev) => {
            if (!prev) return prev
            return false
          })
        }, 1000)
      }
    }
  }, [
    clearStickyReleaseTimeout,
    isStickyScroll,
    isStickyScrollFollowing,
    streamingContent,
    threadId,
  ])

  useEffect(() => {
    if (!isStickyScroll) return
    setIsStickyScrollFollowing(true)
    scrollToBottom(false)
  }, [isStickyScroll, scrollToBottom, threadId])

  useEffect(() => {
    if (!isStickyScroll) return
    if (!isStickyScrollFollowing) return
    if (messageCount === 0) return
    scrollToBottom(true)
  }, [isStickyScroll, isStickyScrollFollowing, messageCount, scrollToBottom])

  useEffect(() => {
    if (!isStickyScroll) return
    if (!isStickyScrollFollowing) return
    if (streamingContent?.thread_id !== threadId) return
    scrollToBottom(false)
  }, [isStickyScroll, isStickyScrollFollowing, scrollToBottom, streamingContent, threadId])

  useEffect(() => {
    userIntendedPositionRef.current = null
    wasStreamingRef.current = false
    setPaddingHeight(0)
    originalPaddingRef.current = 0
    prevCountRef.current = messageCount
    scrollToBottom(false)
    checkScrollState()
    setIsStickyScrollFollowing(true)
    clearStickyReleaseTimeout()
    stickyStreamingActiveRef.current = false
    userForcedUnfollowRef.current = false
    wasAtBottomRef.current = true
    // Only reset when switching threads; keep deps limited intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  useEffect(
    () => () => {
      clearStickyReleaseTimeout()
    },
    [clearStickyReleaseTimeout]
  )

  return useMemo(
    () => ({
      showScrollToBottomBtn,
      scrollToBottom,
      paddingHeight,
    }),
    [paddingHeight, scrollToBottom, showScrollToBottomBtn]
  )
}
