import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from './useAppState'
import { useMessages } from './useMessages'

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
  }, [])


  const showScrollToBottomBtn = !isAtBottom && hasScrollbar

  const scrollToBottom = useCallback((smooth = false) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        ...(smooth ? { behavior: 'smooth' } : {}),
      })
    }
  }, [scrollContainerRef])


  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    const hasScroll = scrollHeight > clientHeight

    if (Math.abs(scrollTop - lastScrollTopRef.current) > 10) {
      if (streamingContent && !isBottom) {
        userIntendedPositionRef.current = scrollTop
      }
    }
    setIsAtBottom(isBottom)
    setHasScrollbar(hasScroll)
    lastScrollTopRef.current = scrollTop
  }, [streamingContent])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll)
      return () =>
        scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  const checkScrollState = useCallback(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    const isBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    const hasScroll = scrollHeight > clientHeight

    setIsAtBottom(isBottom)
    setHasScrollbar(hasScroll)
  }, [])

  useEffect(() => {
    if (!scrollContainerRef.current) return
    if (isFirstRender.current) {
      isFirstRender.current = false
      userIntendedPositionRef.current = null
      wasStreamingRef.current = false
      scrollToBottom(false)
      checkScrollState()
    }
  }, [checkScrollState, scrollToBottom])


  const prevCountRef = useRef(messageCount)
  useEffect(() => {
    const prevCount = prevCountRef.current
    const becameLonger = messageCount > prevCount
    const isUserMessage = lastMessageRole === 'user'

    if (becameLonger && messageCount > 0 && isUserMessage) {
      const calculatePadding = () => {
        const elements = getDOMElements()
        if (!elements?.lastUserMessage) return

        const viewableHeight = elements.scrollContainer.clientHeight
        const userMessageHeight = elements.lastUserMessage.offsetHeight
        const calculatedPadding = Math.max(0, viewableHeight - 40 - userMessageHeight)

        setPaddingHeight(calculatedPadding)
        originalPaddingRef.current = calculatedPadding

        requestAnimationFrame(() => {
          elements.scrollContainer.scrollTo({
            top: elements.scrollContainer.scrollHeight,
            behavior: 'smooth',
          })
        })
      }

      requestAnimationFrame(() => {
        calculatePadding()
        if (!getDOMElements()?.lastUserMessage) {
          requestAnimationFrame(calculatePadding)
        }
      })
    }

    prevCountRef.current = messageCount
  }, [messageCount, lastMessageRole])

  useEffect(() => {
    const previouslyStreaming = wasStreamingRef.current
    const currentlyStreaming = !!streamingContent && streamingContent.thread_id === threadId

    const streamingEnded = previouslyStreaming && !currentlyStreaming
    const hasPaddingToAdjust = originalPaddingRef.current > 0

    if (streamingEnded && hasPaddingToAdjust) {
      requestAnimationFrame(() => {
        const elements = getDOMElements()
        if (!elements?.lastAssistantMessage || !elements?.lastUserMessage) return

        const userRect = elements.lastUserMessage.getBoundingClientRect()
        const assistantRect = elements.lastAssistantMessage.getBoundingClientRect()
        const actualSpacing = assistantRect.top - userRect.bottom
        const totalAssistantHeight = elements.lastAssistantMessage.offsetHeight + actualSpacing
        const newPadding = Math.max(0, originalPaddingRef.current - totalAssistantHeight)

        setPaddingHeight(newPadding)
        originalPaddingRef.current = newPadding
      })
    }

    wasStreamingRef.current = currentlyStreaming
  }, [streamingContent, threadId])

  useEffect(() => {
    userIntendedPositionRef.current = null
    wasStreamingRef.current = false
    setPaddingHeight(0)
    originalPaddingRef.current = 0
    prevCountRef.current = messageCount
    scrollToBottom(false)
    checkScrollState()
  }, [threadId])

  return useMemo(
    () => ({
      showScrollToBottomBtn,
      scrollToBottom,
      paddingHeight
    }),
    [showScrollToBottomBtn, scrollToBottom, paddingHeight]
  )
}
