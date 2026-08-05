import { memo, useMemo } from 'react'
import type { ToolUIPart } from 'ai'
import { GlobeIcon, SearchIcon } from 'lucide-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { parseCitationsFromToolOutput } from '@/lib/citation-parser'
import {
  isToolRunning,
  parseWebFetchOutput,
  type ToolCallBar,
} from '@/lib/toolPresentation'
import { faviconForUrl, hostOf } from '@/lib/webUrl'
import { ToolBar } from './ToolBar'

const Favicon = ({ url }: { url: string }) => (
  <img
    src={faviconForUrl(url)}
    alt=""
    className="size-4 shrink-0 rounded-full border border-border/60 bg-white object-contain"
  />
)

const ResultRow = ({
  url,
  title,
}: {
  url: string
  title?: string
}) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer noopener"
    className="flex items-center gap-2 rounded-md px-2 py-1.5 no-underline transition-colors hover:bg-secondary"
    title={url}
  >
    <Favicon url={url} />
    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
      {title || hostOf(url)}
    </span>
    <span className="shrink-0 text-xs text-muted-foreground/70">
      {hostOf(url)}
    </span>
  </a>
)

export type WebToolWidgetProps = {
  bar: Extract<ToolCallBar, { variant: 'search' | 'address' }>
  state: ToolUIPart['state']
  output?: ToolUIPart['output']
  errorText?: string
}

/**
 * Native web tool calls rendered as the thing they are: a search bar the model
 * types a query into, or an address bar it navigates to, followed by the
 * results. Replaces the raw argument/response JSON for these two tools.
 */
export const WebToolWidget = memo(
  ({ bar, state, output, errorText }: WebToolWidgetProps) => {
    const { t } = useTranslation()
    const running = isToolRunning(state)

    const searchResults = useMemo(() => {
      if (bar.variant !== 'search' || !output) return []
      const parsed = parseCitationsFromToolOutput(output)
      return parsed?.kind === 'web' ? parsed.citations : []
    }, [bar.variant, output])

    const page = useMemo(
      () => (bar.variant === 'address' && output ? parseWebFetchOutput(output) : undefined),
      [bar.variant, output]
    )

    return (
      <div className="space-y-2">
        {bar.variant === 'search' ? (
          <ToolBar
            icon={<SearchIcon className="size-4" />}
            value={bar.query}
            placeholder={t('tools:toolCall.searchPlaceholder')}
            typing={running}
            trailing={
              bar.count !== undefined && (
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  {t('tools:toolCall.resultLimit', { count: bar.count })}
                </span>
              )
            }
          />
        ) : (
          <ToolBar
            icon={<GlobeIcon className="size-4" />}
            value={bar.url}
            placeholder={t('tools:toolCall.addressPlaceholder')}
            typing={running}
            mono
            trailing={bar.url ? <Favicon url={bar.url} /> : undefined}
          />
        )}

        {errorText && (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
            {errorText}
          </div>
        )}

        {running && !errorText && (
          <div className="px-2 text-sm">
            <Shimmer duration={1}>
              {bar.variant === 'search'
                ? t('tools:toolCall.searching')
                : t('tools:toolCall.opening')}
            </Shimmer>
          </div>
        )}

        {!running && !errorText && bar.variant === 'search' && (
          searchResults.length > 0 ? (
            <div className="flex flex-col">
              {searchResults.map((citation) => (
                <ResultRow
                  key={citation.url}
                  url={citation.url}
                  title={citation.title}
                />
              ))}
            </div>
          ) : (
            <p className="px-2 text-sm text-muted-foreground/70">
              {t('tools:toolCall.noResults')}
            </p>
          )
        )}

        {!running && !errorText && page && (
          <div className="space-y-1.5">
            {page.url && <ResultRow url={page.url} title={page.title} />}
            <div className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border px-2 py-1.5 text-xs text-muted-foreground">
              {page.content}
            </div>
            {page.truncated && (
              <p className="px-2 text-xs text-muted-foreground/70">
                {t('tools:toolCall.contentTruncated')}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }
)

WebToolWidget.displayName = 'WebToolWidget'
