import type { ToolPresentation } from '@/lib/tools/types'
import { ExternalLink } from 'lucide-react'
import { WebsiteIcon } from './website-icon'

type WebSearchToolRendererProps = {
  presentation: Extract<ToolPresentation, { kind: 'web_search_exa' }>
}

function getHostname(url?: string) {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function WebSearchToolRenderer({
  presentation,
}: WebSearchToolRendererProps) {
  const { results, errorText } = presentation

  return (
    <div className="space-y-3">
      {errorText && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      {results.length > 0 &&
        results.slice(0, 4).map((result, index) => (
          <div
            key={`${result.url ?? result.title}-${index}`}
            className="rounded-lg border border-border/60 bg-background/30 p-3"
          >
            <div className="flex items-start gap-2">
              <WebsiteIcon url={result.url} />

              <div className="min-w-0 flex-1">
                <div className="font-medium break-words">{result.title}</div>

                {result.url && (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground break-all"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span>{getHostname(result.url)}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
    </div>
  )
}
