import { memo } from 'react'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'
import type { FailedDraft } from '@/stores/failed-draft-store'

type FailedDraftCardProps = {
  draft: FailedDraft
  onRestore: (draft: FailedDraft) => void
  onDismiss: (id: string) => void
}

// Recoverable failed send, shown in the input area. Nothing is sent from here:
// "Restore draft" puts the text and its files back in the composer, and only
// when the user clicks it.
export const FailedDraftCard = memo(function FailedDraftCard({
  draft,
  onRestore,
  onDismiss,
}: FailedDraftCardProps) {
  const files = draft.attachments.length
  return (
    <div
      role="group"
      aria-label="Unsent draft"
      data-testid="failed-draft-card"
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/80 border border-input text-sm max-w-full"
    >
      <IconAlertTriangle
        size={14}
        aria-hidden="true"
        className="shrink-0 text-destructive"
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">
          Message not sent
          {files > 0 ? ` · ${files} file${files === 1 ? '' : 's'}` : ''}
        </div>
        {draft.text.trim() && (
          <div className="truncate text-foreground/70" title={draft.text}>
            {draft.text}
          </div>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
        onClick={() => onRestore(draft)}
      >
        Restore draft
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => onDismiss(draft.id)}
      >
        <IconX size={14} aria-hidden="true" />
      </button>
    </div>
  )
})
