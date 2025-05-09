import { useThreads } from '@/hooks/useThreads'
import { ThreadContent } from './ThreadContent'
import { memo } from 'react'

export const StreamingContent = memo(() => {
  const { streamingContent } = useThreads()
  if (!streamingContent) return null

  return <ThreadContent {...streamingContent} />
})
