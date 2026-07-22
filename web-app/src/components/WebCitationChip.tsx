import { memo } from 'react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { useWebCitationStore } from '@/stores/web-citation-store'
import { cn } from '@/lib/utils'

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const faviconOf = (host: string) =>
  `https://www.google.com/s2/favicons?domain=${host}&sz=64`

export const WebCitationChip = memo(
  ({ messageId, url }: { messageId?: string; url: string }) => {
    const citation = useWebCitationStore((s) =>
      messageId ? s.byMessageId[messageId]?.[url] : undefined
    )
    const host = hostOf(url)
    const favicon = citation?.favicon || faviconOf(host)
    return (
      <HoverCard openDelay={80} closeDelay={120}>
        <HoverCardTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="mx-0.5 inline-flex translate-y-[-0.15em] align-baseline no-underline"
            title={citation?.title || url}
          >
            <img
              src={favicon}
              alt=""
              className="inline-block size-3.5 rounded-full border border-border/60 bg-white object-contain hover:ring-2 hover:ring-primary/40"
            />
          </a>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          side="top"
          className="w-72 space-y-2 p-3 text-xs"
        >
          <div className="flex items-center gap-2">
            <img
              src={favicon}
              alt=""
              className="size-4 shrink-0 rounded-full border border-border/60 bg-white object-contain"
            />
            <span className="truncate text-muted-foreground">{host}</span>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className={cn('block truncate font-medium hover:underline')}
          >
            {citation?.title || host}
          </a>
          {citation?.text && (
            <p className="line-clamp-4 whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {citation.text}
            </p>
          )}
        </HoverCardContent>
      </HoverCard>
    )
  }
)
WebCitationChip.displayName = 'WebCitationChip'
