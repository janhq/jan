import { memo, useMemo } from 'react'
import { FileTextIcon } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useGroundingStore } from '@/stores/grounding-store'
import { useAttachmentName } from '@/hooks/useAttachmentNames'
import { cn } from '@/lib/utils'

const HREF_RE = /^#cite-(.+)-(\d+)$/

type Parsed = { messageId: string; index: number } | null

const parseHref = (href: string | undefined): Parsed => {
  if (!href) return null
  const m = HREF_RE.exec(href)
  if (!m) return null
  return { messageId: m[1], index: Number(m[2]) - 1 }
}

export const CitationLink = memo(
  ({
    href,
    children,
    className,
  }: {
    href?: string
    children?: React.ReactNode
    className?: string
  }) => {
    const parsed = useMemo(() => parseHref(href), [href])

    const citation = useGroundingStore((s) => {
      if (!parsed) return undefined
      return s.byMessageId[parsed.messageId]?.citations[parsed.index]
    })

    const filename = useAttachmentName(citation?.file_id)

    if (!parsed || !citation) {
      return (
        <a href={href} className={className}>
          {children}
        </a>
      )
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'no-underline text-primary hover:text-primary/80 mx-0.5 align-super text-[0.7em] cursor-pointer',
              className
            )}
          >
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-80 p-3 text-xs space-y-2"
        >
          <div className="flex items-center gap-2">
            <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              {filename || `${citation.file_id.slice(0, 8)}…`}
            </span>
            {typeof citation.chunk_file_order === 'number' && (
              <span className="text-muted-foreground">
                #{citation.chunk_file_order}
              </span>
            )}
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {typeof citation.score === 'number' ? citation.score.toFixed(2) : ''}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-60 overflow-auto">
            {citation.text}
          </p>
        </PopoverContent>
      </Popover>
    )
  }
)
CitationLink.displayName = 'CitationLink'
