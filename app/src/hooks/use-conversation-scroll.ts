import { useCallback, useEffect, useRef } from 'react'
import { useConversationAtBottom } from '@/components/ai-elements/conversation'
import type { ChatStatus } from 'ai'
import type { GetTargetScrollTop, StickToBottomContext } from 'use-stick-to-bottom'

type UseConversationScrollArgs = {
  status: ChatStatus
  isLoadingMessages: boolean
  waitingForScroll: boolean
}

export const useConversationScroll = ({
  status,
  isLoadingMessages,
  waitingForScroll,
}: UseConversationScrollArgs) => {
  const conversationContextRef = useRef<StickToBottomContext | null>(null)
  // Tracks in-flight manual scrolls so we can temporarily re-enable stickiness
  const forcedStickToBottomRef = useRef(0)

  const scrollConversationToBottom = useCallback(
    (options?: Parameters<StickToBottomContext['scrollToBottom']>[0]) => {
      const context = conversationContextRef.current
      if (!context) return

      forcedStickToBottomRef.current += 1
      const finish = () => {
        forcedStickToBottomRef.current = Math.max(
          0,
          forcedStickToBottomRef.current - 1
        )
      }

      try {
        const result = context.scrollToBottom(options)
        void Promise.resolve(result).finally(finish)
        return result
      } catch (error) {
        finish()
        throw error
      }
    },
    []
  )

  const isStreaming = status === 'streaming'

  // Disable automatic stickiness outside streaming/loading unless we're forcing a scroll
  const stickToBottomTarget = useCallback<GetTargetScrollTop>(
    (targetScrollTop, { scrollElement }) => {
      const shouldStick =
        isStreaming ||
        isLoadingMessages ||
        waitingForScroll ||
        forcedStickToBottomRef.current > 0

      if (!shouldStick && scrollElement) {
        return scrollElement.scrollTop
      }

      return targetScrollTop
    },
    [isStreaming, isLoadingMessages, waitingForScroll]
  )

  // Keep stick-to-bottom active only while streaming (or during forced scrolls)
  useEffect(() => {
    if (isStreaming) {
      scrollConversationToBottom('instant')
    }
  }, [isStreaming, scrollConversationToBottom])

  const scrollToBottomSmooth = useCallback(() => {
    scrollConversationToBottom('smooth')
  }, [scrollConversationToBottom])

  const scrollToBottomAfterSubmit = useCallback(() => {
    const isAtBottom = conversationContextRef.current?.state.isAtBottom
    scrollConversationToBottom(isAtBottom ? 'instant' : 'smooth')
  }, [scrollConversationToBottom])

  return {
    conversationContextRef,
    stickToBottomTarget,
    scrollConversationToBottom,
    scrollToBottomSmooth,
    scrollToBottomAfterSubmit,
    isStreaming,
  }
}

type ScrollStabilizerProps = {
  onStabilized: () => void
  enabled: boolean
  hasContent: boolean
}

// Watches scroll position and signals when stabilized at bottom
export const ConversationScrollStabilizer = ({
  onStabilized,
  enabled,
  hasContent,
}: ScrollStabilizerProps) => {
  const isAtBottom = useConversationAtBottom()
  const hasStabilized = useRef(false)

  useEffect(() => {
    // Only stabilize when enabled, has content, and scroll is at bottom
    if (enabled && hasContent && isAtBottom && !hasStabilized.current) {
      hasStabilized.current = true
      // Small delay to ensure paint is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onStabilized()
        })
      })
    }
  }, [isAtBottom, enabled, hasContent, onStabilized])

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      hasStabilized.current = false
    }
  }, [enabled])

  return null
}
