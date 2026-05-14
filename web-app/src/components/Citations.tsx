import { memo, useMemo, useState } from 'react'
import { FileTextIcon, GlobeIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useAttachmentName,
  useEnsureAttachmentNames,
} from '@/hooks/useAttachmentNames'

export type RagCitation = {
  id: string
  text: string
  score: number
  file_id: string
  chunk_file_order?: number
}

export type WebCitation = {
  url: string
  title?: string
  text?: string
  score?: number
  published_date?: string
  author?: string
  favicon?: string
}

export type CitationsPayload =
  | {
      kind: 'rag'
      query?: string
      scope?: 'thread' | 'project'
      threadId?: string
      projectId?: string
      citations: RagCitation[]
    }
  | {
      kind: 'web'
      query?: string
      citations: WebCitation[]
    }

const formatScore = (s: number | undefined) =>
  typeof s === 'number' ? s.toFixed(2) : ''

const RagCitationItem = memo(
  ({
    c,
    index,
    anchorId,
  }: {
    c: RagCitation
    index: number
    anchorId?: string
  }) => {
  const [expanded, setExpanded] = useState(false)
  const name = useAttachmentName(c.file_id) || `${c.file_id.slice(0, 8)}…`
  return (
    <li
      id={anchorId}
      className="scroll-mt-16 rounded-md border bg-card/40 px-3 py-2 text-xs target:ring-2 target:ring-primary/60"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] text-muted-foreground">
          {index + 1}
        </span>
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{name}</span>
        {typeof c.chunk_file_order === 'number' && (
          <span className="text-muted-foreground">#{c.chunk_file_order}</span>
        )}
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {formatScore(c.score)}
        </span>
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
      </button>
      {expanded && c.text && (
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground leading-relaxed">
          {c.text}
        </p>
      )}
    </li>
  )
  }
)
RagCitationItem.displayName = 'RagCitationItem'

const WebCitationItem = memo(({ c }: { c: WebCitation }) => {
  const [expanded, setExpanded] = useState(false)
  let host = ''
  try {
    host = new URL(c.url).hostname.replace(/^www\./, '')
  } catch {
    host = c.url
  }
  return (
    <li className="rounded-md border bg-card/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {c.favicon ? (
          <img src={c.favicon} alt="" className="size-3.5 rounded-sm" />
        ) : (
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate font-medium hover:underline"
          title={c.url}
        >
          {c.title || host}
        </a>
        <span className="ml-auto truncate text-[10px] text-muted-foreground">
          {host}
        </span>
        {typeof c.score === 'number' && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {formatScore(c.score)}
          </span>
        )}
        {c.text && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground"
            aria-label="toggle snippet"
          >
            <ChevronRightIcon
              className={cn(
                'size-3 transition-transform',
                expanded && 'rotate-90'
              )}
            />
          </button>
        )}
      </div>
      {expanded && c.text && (
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground leading-relaxed">
          {c.text}
        </p>
      )}
    </li>
  )
})
WebCitationItem.displayName = 'WebCitationItem'

export const Citations = memo(
  ({
    payload,
    anchorPrefix,
  }: {
    payload: CitationsPayload
    anchorPrefix?: string
  }) => {
  useEnsureAttachmentNames(
    payload.kind === 'rag' ? payload.scope : undefined,
    payload.kind === 'rag'
      ? payload.scope === 'project'
        ? payload.projectId
        : payload.threadId
      : undefined
  )

  const items = useMemo(() => {
    if (payload.kind === 'rag') {
      return payload.citations.map((c, i) => (
        <RagCitationItem
          key={c.id}
          c={c}
          index={i}
          anchorId={anchorPrefix ? `${anchorPrefix}-${i + 1}` : undefined}
        />
      ))
    }
    return payload.citations.map((c, i) => (
      <WebCitationItem key={`${c.url}-${i}`} c={c} />
    ))
  }, [payload, anchorPrefix])

  if (!items.length) return null

  const heading =
    payload.kind === 'rag'
      ? `${payload.citations.length} document ${
          payload.citations.length === 1 ? 'citation' : 'citations'
        }`
      : `${payload.citations.length} web ${
          payload.citations.length === 1 ? 'source' : 'sources'
        }`

  return (
    <div className="mt-4 space-y-2">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {heading}
        {payload.query && (
          <span className="ml-2 normal-case font-normal text-muted-foreground/70">
            for &ldquo;{payload.query}&rdquo;
          </span>
        )}
      </h4>
      <ul className="space-y-1.5">{items}</ul>
    </div>
  )
})
Citations.displayName = 'Citations'
