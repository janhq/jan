import type { ToolPresentation } from '@/lib/tools/types'
import { ExternalLink } from 'lucide-react'
import { WebsiteIcon } from './website-icon'

type WebFetchToolRendererProps = {
  presentation: Extract<ToolPresentation, { kind: 'web_fetch_exa' }>
}

function getHostname(url?: string) {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function WebFetchToolRenderer({
  presentation,
}: WebFetchToolRendererProps) {
  const { pages, errorText } = presentation

  return (
    <div className="space-y-3">
      {errorText && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      {pages.length > 0 &&
        pages.map((page, index) => (
          <div
            key={`${page.url ?? page.title}-${index}`}
            className="rounded-lg border border-border/60 bg-background/30 p-3"
          >
            <div className="flex items-start gap-2">
              <WebsiteIcon url={page.url} />

              <div className="min-w-0 flex-1">
                <div className="font-medium break-words">
                  {page.title || 'Untitled page'}
                </div>

                {page.url && (
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground break-all"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span>{getHostname(page.url)}</span>
                  </a>
                )}

                {page.highlights.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {page.highlights.slice(0, 4).map((highlight, i) => (
                      <li key={i} className="break-words">
                        {highlight}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ))}
    </div>
  )
}
