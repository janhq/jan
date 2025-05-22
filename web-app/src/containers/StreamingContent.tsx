import { useAppState } from '@/hooks/useAppState'
import { ThreadContent } from './ThreadContent'
import { memo } from 'react'
import { useMessages } from '@/hooks/useMessages'

type Props = {
  threadId: string
}

// Use memo with no dependencies to allow re-renders when props change
export const StreamingContent = memo(({ threadId }: Props) => {
  const { streamingContent } = useAppState()
  const { getMessages } = useMessages()
  const messages = getMessages(threadId)

  if (!streamingContent || streamingContent.thread_id !== threadId) return null

  // Pass a new object to ThreadContent to avoid reference issues
  // The streaming content is always the last message
  return (
    <ThreadContent
      {...streamingContent}
      isLastMessage={true}
      showAssistant={
        messages.length > 0
          ? messages[messages.length - 1].role !== 'assistant'
          : true
      }
    />
  )
})
