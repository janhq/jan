import { useThreadScrolling } from '@/hooks/useThreadScrolling'

export const ThreadPadding = ({
  threadId,
  scrollContainerRef,
}: {
  threadId: string
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}) => {
  // Get padding height for ChatGPT-style message positioning
  const { paddingHeight } = useThreadScrolling(threadId, scrollContainerRef)
  return (
    <div
      style={{ height: paddingHeight }}
      className="flex-shrink-0"
      data-testid="chat-padding"
    />
  )
}
