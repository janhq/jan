import { memo, useMemo } from 'react'
import type { ToolUIPart } from 'ai'
import { FileSearchIcon } from 'lucide-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Citations } from '@/components/Citations'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { parseCitationsFromToolOutput } from '@/lib/citation-parser'
import { isToolRunning, type ToolCallBar } from '@/lib/toolPresentation'
import { ToolBar } from './ToolBar'

export type RagToolWidgetProps = {
  bar: Extract<ToolCallBar, { variant: 'documents' }>
  state: ToolUIPart['state']
  output?: ToolUIPart['output']
  errorText?: string
  messageId?: string
  citationOffset?: number
}

/**
 * A document retrieval reads as a search over your own files: the query fills
 * in as the model writes it, then the matched snippets render as citation
 * cards, which already resolve file names and scores.
 */
export const RagToolWidget = memo(
  ({
    bar,
    state,
    output,
    errorText,
    messageId,
    citationOffset = 0,
  }: RagToolWidgetProps) => {
    const { t } = useTranslation()
    const running = isToolRunning(state)

    const payload = useMemo(() => {
      if (!output) return undefined
      const parsed = parseCitationsFromToolOutput(output)
      return parsed?.kind === 'rag' && parsed.citations.length > 0
        ? parsed
        : undefined
    }, [output])

    const scopeLabel = [
      bar.count !== undefined
        ? t('tools:toolCall.resultLimit', { count: bar.count })
        : undefined,
      bar.fileCount !== undefined
        ? t('tools:toolCall.fileFilter', { count: bar.fileCount })
        : undefined,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div className="space-y-2">
        <ToolBar
          icon={<FileSearchIcon className="size-4" />}
          value={bar.query}
          placeholder={t('tools:toolCall.documentsPlaceholder')}
          typing={running}
          trailing={
            scopeLabel ? (
              <span className="shrink-0 text-xs text-muted-foreground/70">
                {scopeLabel}
              </span>
            ) : undefined
          }
        />

        {errorText && (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
            {errorText}
          </div>
        )}

        {running && !errorText && (
          <div className="px-2 text-sm">
            <Shimmer duration={1}>
              {t('tools:toolCall.searchingDocuments')}
            </Shimmer>
          </div>
        )}

        {!running &&
          !errorText &&
          (payload ? (
            <Citations
              payload={payload}
              anchorPrefix={messageId ? `cite-${messageId}` : undefined}
              indexOffset={citationOffset}
            />
          ) : (
            <p className="px-2 text-sm text-muted-foreground/70">
              {t('tools:toolCall.noMatches')}
            </p>
          ))}
      </div>
    )
  }
)

RagToolWidget.displayName = 'RagToolWidget'
