import { IconX } from '@tabler/icons-react'
import { selectThreadNotices, useMonitorNotices } from '@/stores/monitor-notice-store'

/**
 * Display-only monitor completion notices above the composer. States only that
 * the monitor finished and what it reported; it does not promise the assistant
 * will answer. Dismiss hides the row and never touches the model inbox, so the
 * next user turn still receives the marked notice once.
 */
export function ChatMonitorNotices({ threadId }: { threadId: string }) {
  const notices = useMonitorNotices(selectThreadNotices(threadId))
  const dismiss = useMonitorNotices((s) => s.dismiss)
  if (!notices.length) return null
  return (
    <div className="pb-2 flex flex-col gap-1.5" data-testid="chat-monitor-notices">
      {notices.map((n) => (
        <div
          key={n.id}
          role="status"
          className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              Monitor finished{n.headline ? `: ${n.headline}` : ''}
            </div>
            {n.detail && (
              <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground line-clamp-4">
                {n.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss monitor notice"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => dismiss(threadId, n.id)}
          >
            <IconX aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
