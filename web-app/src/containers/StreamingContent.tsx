import { useAppState } from '@/hooks/useAppState'
import { ThreadContent } from './ThreadContent'
import { memo, useMemo } from 'react'
import { useMessages } from '@/hooks/useMessages'
import { MessageStatus } from '@janhq/core'

type Props = {
  threadId: string
}

// Helper to extract <think>...</think> segment
function extractReasoningSegment(text: string) {
  if (!text) return ''
  const match = text.match(/<think>([\s\S]*?)<\/think>/)
  if (match) return match[0].trim()
  // If only opening <think> and no closing, take everything after <think>
  const openIdx = text.indexOf('<think>')
  if (openIdx !== -1) return text.slice(openIdx).trim()
  return ''
}

// Use memo with no dependencies to allow re-renders when props change
// Avoid duplicate reasoning segments after tool calls
export const StreamingContent = memo(({ threadId }: Props) => {
  const streamingContent = useAppState((state) => state.streamingContent)
  const { getMessages } = useMessages()
  const messages = getMessages(threadId)

  const streamingReasoning = useMemo(() => {
    const text =
      streamingContent?.content?.find((e) => e.type === 'text')?.text?.value ||
      ''
    return extractReasoningSegment(text)
  }, [streamingContent])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamingTools: any = useMemo(() => {
    const calls = streamingContent?.metadata?.tool_calls
    return calls
  }, [streamingContent])

  const lastAssistant = useMemo(() => {
    return [...messages].reverse().find((m) => m.role === 'assistant')
  }, [messages])
  const lastAssistantReasoning = useMemo(() => {
    if (!lastAssistant) return ''
    const text =
      lastAssistant.content?.find((e) => e.type === 'text')?.text?.value || ''
    return extractReasoningSegment(text)
  }, [lastAssistant])

  if (!streamingContent || streamingContent.thread_id !== threadId) {
    return null
  }

  if (streamingReasoning && streamingReasoning === lastAssistantReasoning) {
    return null
  }

  // Don't show streaming content if there's already a stopped message
  if (lastAssistant?.status === MessageStatus.Stopped) {
    return null
  }

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
      streamingThread={streamingContent.thread_id}
      showAssistant={
        messages.length > 0
          ? messages[messages.length - 1].role !== 'assistant'
          : true
      }
    />
  )
})
