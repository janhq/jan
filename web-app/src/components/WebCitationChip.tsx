import { memo } from 'react'
import { IconLink } from '@tabler/icons-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { useWebCitationStore } from '@/stores/web-citation-store'
import { cn } from '@/lib/utils'
import { faviconForUrl, hostOf } from '@/lib/webUrl'
import { ExternalAnchor } from '@/components/ExternalAnchor'
import { useRemoteImagesAllowed } from '@/lib/extensions/remoteImages'

export const WebCitationChip = memo(
  ({ messageId, url }: { messageId?: string; url: string }) => {
    const citation = useWebCitationStore((s) =>
      messageId ? s.byMessageId[messageId]?.[url] : undefined
    )
    const host = hostOf(url)
    // Off in content an extension authored: the favicon is fetched from a host
    // the citation names, or from the favicon service with that host in the
    // query, so the extension could reach any host through it.
    const favicon = useRemoteImagesAllowed()
      ? citation?.favicon || faviconForUrl(url)
      : undefined
    return (
      <HoverCard openDelay={80} closeDelay={120}>
        <HoverCardTrigger asChild>
          <ExternalAnchor
            href={url}
            className="mx-0.5 inline-flex translate-y-[-0.15em] align-baseline no-underline"
            title={citation?.title || url}
          >
            {favicon ? (
              <img
                src={favicon}
                alt=""
                className="inline-block size-3.5 rounded-full border border-border/60 bg-white object-contain hover:ring-2 hover:ring-primary/40"
              />
            ) : (
              <IconLink
                aria-hidden
                className="inline-block size-3.5 rounded-full border border-border/60 text-muted-foreground hover:ring-2 hover:ring-primary/40"
              />
            )}
          </ExternalAnchor>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          side="top"
          className="w-72 space-y-2 p-3 text-xs"
        >
          <div className="flex items-center gap-2">
            {favicon ? (
              <img
                src={favicon}
                alt=""
                className="size-4 shrink-0 rounded-full border border-border/60 bg-white object-contain"
              />
            ) : (
              <IconLink
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            <span className="truncate text-muted-foreground">{host}</span>
          </div>
          <ExternalAnchor
            href={url}
            className={cn('block truncate font-medium hover:underline')}
          >
            {citation?.title || host}
          </ExternalAnchor>
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
