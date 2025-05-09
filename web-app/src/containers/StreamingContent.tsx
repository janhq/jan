import { useThreads } from '@/hooks/useThreads'
import { ThreadContent } from './ThreadContent'

// Remove memo to ensure component re-renders when streamingContent changes
export const StreamingContent = () => {
  const { streamingContent } = useThreads()
  if (!streamingContent) return null
  return <ThreadContent {...streamingContent} />
}
