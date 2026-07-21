import { memo, useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Citations, type WebCitation } from '@/components/Citations'

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const faviconOf = (url: string) =>
  `https://www.google.com/s2/favicons?domain=${hostOf(url)}&sz=64`

export const WebSourcesRow = memo(
  ({ citations }: { citations: WebCitation[] }) => {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)

    const unique = useMemo(() => {
      const seen = new Set<string>()
      const out: WebCitation[] = []
      for (const c of citations) {
        if (seen.has(c.url)) continue
        seen.add(c.url)
        out.push(c)
      }
      return out
    }, [citations])

    if (!unique.length) return null

    const preview = unique.slice(0, 4)

    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border bg-card/40 py-1 pl-1.5 pr-2.5 text-xs text-muted-foreground transition-colors hover:bg-card/70"
          aria-expanded={expanded}
        >
          <span className="flex -space-x-1.5">
            {preview.map((c) => (
              <img
                key={c.url}
                src={c.favicon || faviconOf(c.url)}
                alt=""
                className="size-4 rounded-full border border-border/60 bg-white object-contain"
              />
            ))}
          </span>
          <span className="font-medium">
            {t('chat:webSources', { count: unique.length })}
          </span>
          <ChevronRightIcon
            className={cn(
              'size-3 shrink-0 transition-transform',
              expanded && 'rotate-90'
            )}
          />
        </button>
        {expanded && (
          <Citations payload={{ kind: 'web', citations: unique }} />
        )}
      </div>
    )
  }
)
WebSourcesRow.displayName = 'WebSourcesRow'
