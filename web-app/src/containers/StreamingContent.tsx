import { useAppState } from '@/hooks/useAppState'
import { ThreadContent } from './ThreadContent'
import { memo } from 'react'
import { useAppState } from '@/hooks/useAppState'

// Use memo with no dependencies to allow re-renders when props change
export const StreamingContent = memo(() => {
  const { streamingContent } = useAppState()

  if (!streamingContent) return null

  // Pass a new object to ThreadContent to avoid reference issues
  // The streaming content is always the last message
  return <ThreadContent {...streamingContent} isLastMessage={true} />
})
