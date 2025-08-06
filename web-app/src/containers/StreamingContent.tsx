import { useAppState } from '@/hooks/useAppState'
import { ThreadContent } from './ThreadContent'
import { memo, useMemo } from 'react'
import { useMessages } from '@/hooks/useMessages'

type Props = {
  threadId: string
}

// Use memo with no dependencies to allow re-renders when props change
// Avoid duplicate reasoning segments after tool calls
export const StreamingContent = memo(({ threadId }: Props) => {
  const { streamingContent } = useAppState()
  const { getMessages } = useMessages()
  const messages = getMessages(threadId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamingTools: any = useMemo(() => {
    const calls = streamingContent?.metadata?.tool_calls
    return calls
  }, [streamingContent])

  if (!streamingContent || streamingContent.thread_id !== threadId) return null


  // Pass a new object to ThreadContent to avoid reference issues
  // The streaming content is always the last message
  return (
    <ThreadContent
      streamTools={{
        tool_calls: {
          function: {
            name: streamingTools?.[0]?.function?.name as string,
            arguments: streamingTools?.[0]?.function?.arguments as string,
          },
        },
      }}
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
