import { memo } from 'react'
import { IconClock, IconX } from '@tabler/icons-react'
import type { QueuedMessage } from '@/stores/message-queue-store'

type QueuedMessageChipProps = {
  message: QueuedMessage
  onEdit?: (message: QueuedMessage) => void
  onRemove?: (id: string) => void
}

// Compact chip for a queued message, displayed inside the chat input area.
// Click the text to edit it (puts it back in the input), click X to discard.
export const QueuedMessageChip = memo(function QueuedMessageChip({
  message,
  onEdit,
  onRemove,
}: QueuedMessageChipProps) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary/80 border border-input text-sm max-w-full">
      <IconClock size={14} className="shrink-0 text-muted-foreground animate-pulse" />
      <span
        className="truncate text-foreground/70 cursor-pointer hover:text-foreground transition-colors"
        onClick={() => onEdit?.(message)}
        title="Click to edit"
      >
        {message.text}
      </span>
      {onRemove && (
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onRemove(message.id)}
        >
          <IconX size={14} />
        </button>
      )}
    </div>
  )
})
