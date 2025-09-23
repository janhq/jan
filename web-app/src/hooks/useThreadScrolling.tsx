import {  useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from './useAppState'
import { useMessages } from './useMessages'
import { useShallow } from 'zustand/react/shallow'
import debounce from 'lodash.debounce'

export const useThreadScrolling = (
  threadId: string,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
) => {
  const streamingContent = useAppState((state) => state.streamingContent)
  const isFirstRender = useRef(true)
  const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )
  const wasStreamingRef = useRef(false)
  const userIntendedPositionRef = useRef<number | null>(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasScrollbar, setHasScrollbar] = useState(false)
  const lastScrollTopRef = useRef(0)
  const messagesCount = useMemo(() => messages?.length ?? 0, [messages])

  const showScrollToBottomBtn = !isAtBottom && hasScrollbar

  const scrollToBottom = (smooth = false) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        ...(smooth ? { behavior: 'smooth' } : {}),
      })
    }
  }

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    // Use a small tolerance to better detect when we're at the bottom
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    const hasScroll = scrollHeight > clientHeight

    // Detect if this is a user-initiated scroll
    if (Math.abs(scrollTop - lastScrollTopRef.current) > 10) {
      setIsUserScrolling(!isBottom)

      // If user scrolls during streaming and moves away from bottom, record their intended position
      if (streamingContent && !isBottom) {
        userIntendedPositionRef.current = scrollTop
      }
    }
    setIsAtBottom(isBottom)
    setHasScrollbar(hasScroll)
    lastScrollTopRef.current = scrollTop
  }

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.addEventListener('scroll', handleScroll)
      return () =>
        scrollContainerRef.current?.removeEventListener('scroll', handleScroll)
    }
  }, [scrollContainerRef])

  const checkScrollState = () => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    const hasScroll = scrollHeight > clientHeight

    setIsAtBottom(isBottom)
    setHasScrollbar(hasScroll)
  }

  // Single useEffect for all auto-scrolling logic
  useEffect(() => {
    // Track streaming state changes
    const isCurrentlyStreaming = !!streamingContent
    const justFinishedStreaming =
      wasStreamingRef.current && !isCurrentlyStreaming
    wasStreamingRef.current = isCurrentlyStreaming

    // If streaming just finished and user had an intended position, restore it
    if (justFinishedStreaming && userIntendedPositionRef.current !== null) {
      // Small delay to ensure DOM has updated
      setTimeout(() => {
        if (
          scrollContainerRef.current &&
          userIntendedPositionRef.current !== null
        ) {
          scrollContainerRef.current.scrollTo({
            top: userIntendedPositionRef.current,
            behavior: 'smooth',
          })
          userIntendedPositionRef.current = null
          setIsUserScrolling(false)
        }
      }, 100)
      return
    }
    // Clear intended position when streaming starts fresh
    if (isCurrentlyStreaming && !wasStreamingRef.current) {
      userIntendedPositionRef.current = null
    }

    // Only auto-scroll when the user is not actively scrolling
    // AND either at the bottom OR there's streaming content
    if (!isUserScrolling && (streamingContent || isAtBottom) && messagesCount) {
      // Use non-smooth scrolling for auto-scroll to prevent jank
      scrollToBottom(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingContent, isUserScrolling, messagesCount])

  useEffect(() => {
    if (streamingContent) {
      const interval = setInterval(checkScrollState, 100)
      return () => clearInterval(interval)
    }
  }, [streamingContent])

  // Auto-scroll to bottom when component mounts or thread content changes
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    // Always scroll to bottom on first render or when thread changes
    if (isFirstRender.current) {
      isFirstRender.current = false
      scrollToBottom()
      setIsAtBottom(true)
      setIsUserScrolling(false)
      userIntendedPositionRef.current = null
      wasStreamingRef.current = false
      checkScrollState()
      return
    }
  }, [])

  const handleDOMScroll = (e: Event) => {
    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    // Use a small tolerance to better detect when we're at the bottom
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    const hasScroll = scrollHeight > clientHeight

    // Detect if this is a user-initiated scroll
    if (Math.abs(scrollTop - lastScrollTopRef.current) > 10) {
      setIsUserScrolling(!isBottom)

      // If user scrolls during streaming and moves away from bottom, record their intended position
      if (streamingContent && !isBottom) {
        userIntendedPositionRef.current = scrollTop
      }
    }
    setIsAtBottom(isBottom)
    setHasScrollbar(hasScroll)
    lastScrollTopRef.current = scrollTop
  }
  //   Use a shorter debounce time for more responsive scrolling
  const debouncedScroll = debounce(handleDOMScroll)

  useEffect(() => {
    const chatHistoryElement = scrollContainerRef.current
    if (chatHistoryElement) {
      chatHistoryElement.addEventListener('scroll', debouncedScroll)
      return () =>
        chatHistoryElement.removeEventListener('scroll', debouncedScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset scroll state when thread changes
  useEffect(() => {
    isFirstRender.current = true
    scrollToBottom()
    setIsAtBottom(true)
    setIsUserScrolling(false)
    userIntendedPositionRef.current = null
    wasStreamingRef.current = false
    checkScrollState()
  }, [threadId])

  return useMemo(
    () => ({ showScrollToBottomBtn, scrollToBottom, setIsUserScrolling }),
    [showScrollToBottomBtn, scrollToBottom, setIsUserScrolling]
  )
}
