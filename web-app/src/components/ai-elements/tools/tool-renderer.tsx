import type { ToolUIPart } from 'ai'
import type { ToolPresentation } from '@/lib/tools/types'
import { ToolContent, ToolHeader } from './tool'
import { WebSearchToolRenderer } from './renderers/web-search-tool-renderer'
import { WebFetchToolRenderer } from './renderers/web-fetch-tool-renderer'
import { GenericToolRenderer } from './renderers/generic-tool-renderer'

export function ToolRenderer({
  presentation,
  state,
}: {
  presentation: ToolPresentation
  state: ToolUIPart['state']
}) {
  return (
    <>
      <ToolHeader
        title={presentation.title}
        subtitle={presentation.subtitle}
        type={`tool-${presentation.kind}` as `tool-${string}`}
        state={state}
      />

      <ToolContent>
        {presentation.kind === 'web_search_exa' && (
          <WebSearchToolRenderer presentation={presentation} />
        )}

        {presentation.kind === 'web_fetch_exa' && (
          <WebFetchToolRenderer presentation={presentation} />
        )}

        {presentation.kind === 'generic' && (
          <GenericToolRenderer presentation={presentation} />
        )}
      </ToolContent>
    </>
  )
}
