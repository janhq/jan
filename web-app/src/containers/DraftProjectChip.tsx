import { Folder, X } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { ThreadFolder } from '@/services/projects/types'

/** The Jan project the next conversation will be filed under. */
export function DraftProjectChip({
  project,
  onRemove,
}: {
  project: ThreadFolder
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-center gap-2 pt-2 text-sm text-muted-foreground"
      data-testid="home-chat-project"
    >
      <Folder className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{project.name}</span>
      <button
        type="button"
        className="rounded-sm p-1 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('common:conversationScope.removeProject')}
        onClick={onRemove}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
