import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useOpenUISettings } from '@/hooks/useOpenUISettings'
import { useThreads } from '@/hooks/useThreads'
import { extractOpenUIResponse } from '@/lib/openui-detect'
import { lazy, memo, Suspense, useMemo } from 'react'

const OpenUIRenderedContent = lazy(() =>
  import('./OpenUIRenderedContent').then((module) => ({
    default: module.OpenUIRenderedContent,
  }))
)

interface OpenUIResponseProps {
  content: string
  className?: string
  isUser?: boolean
  isStreaming?: boolean
  messageId?: string
  isAnimating?: boolean
}

function OpenUIResponseComponent({
  content,
  className,
  isUser,
  isStreaming,
  messageId,
  isAnimating,
}: OpenUIResponseProps) {
  const threadId = useThreads((state) => state.currentThreadId)
  const enabled = useOpenUISettings(
    (state) =>
      threadId !== undefined && state.enabledThreads[threadId] === true
  )

  const openUIResponse = useMemo(
    () => (enabled && !isUser ? extractOpenUIResponse(content) : null),
    [content, enabled, isUser]
  )

  if (!openUIResponse) {
    return (
      <RenderMarkdown
        content={content}
        className={className}
        isUser={isUser}
        isStreaming={isStreaming}
        messageId={messageId}
        isAnimating={isAnimating}
      />
    )
  }

  return (
    <Suspense
      fallback={
        <RenderMarkdown
          content={content}
          className={className}
          isUser={isUser}
          isStreaming={isStreaming}
          messageId={messageId}
          isAnimating={isAnimating}
        />
      }
    >
      <OpenUIRenderedContent
        content={content}
        openUIResponse={openUIResponse}
        className={className}
        isUser={isUser}
        isStreaming={isStreaming}
        messageId={messageId}
        isAnimating={isAnimating}
      />
    </Suspense>
  )
}

export const OpenUIResponse = memo(
  OpenUIResponseComponent,
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.className === nextProps.className &&
    prevProps.isUser === nextProps.isUser &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.isAnimating === nextProps.isAnimating
)
